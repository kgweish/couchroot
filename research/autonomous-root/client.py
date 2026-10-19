#!/usr/bin/env python3
"""Certificate-pinned administrator client. No automatic command retries."""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import ssl
import uuid
import os
import time
import sys
import re


class OperationError(RuntimeError):
    def __init__(self, value):
        self.result = value
        self.outcome = value.get('outcome', 'rejected')
        super().__init__(json.dumps(value))


class Session:
    """One sequential, pinned connection; never replay a failed request.

    A transfer owns its session. It closes on exit, error, explicit peer close,
    or before a new request after the idle/request-count limit.
    """
    MAX_REQUESTS = 128
    MAX_IDLE_SECONDS = 4

    def __init__(self, config, *, keep_alive=True):
        self.config = dict(config)
        self.keep_alive = keep_alive
        self.context = None
        self.connection = None
        self.requests = 0
        self.last_response = 0
        self.failed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def request(self, method, route, body=None, *, binary=None, raw_response=False, timeout=40):
        if self.failed:
            raise RuntimeError('Session failed; inspect the outcome before starting another operation')
        try:
            if self.connection is not None and (self.connection.sock is None
                    or self.requests >= self.MAX_REQUESTS
                    or time.monotonic() - self.last_response >= self.MAX_IDLE_SECONDS):
                self.close()
            if self.context is None:
                self.context = ssl.create_default_context(cafile=self.config['server_certificate'])
                self.context.check_hostname = False  # Exact pin is checked on every new socket.
                self.context.minimum_version = ssl.TLSVersion.TLSv1_2
                self.context.load_cert_chain(self.config['client_certificate'], self.config['client_key'])
            if self.connection is None:
                self.connection = http.client.HTTPSConnection(self.config['host'], self.config['port'], context=self.context, timeout=timeout)
                # Prevent http.client from silently creating an unpinned socket in send().
                self.connection.auto_open = 0
                self.connection.connect()
                if hashlib.sha256(self.connection.sock.getpeercert(binary_form=True)).hexdigest() != self.config['server_sha256']:
                    raise RuntimeError('Server certificate pin mismatch; no command submitted')
                self.requests = 0
            self.connection.sock.settimeout(timeout)
            headers = {'Content-Type': 'application/json', 'Connection': 'keep-alive' if self.keep_alive else 'close'}
            payload = json.dumps(body) if body is not None else None
            if binary is not None:
                headers.update({'Content-Type': 'application/octet-stream', 'X-Operation': json.dumps(body)})
                payload = binary
            self.connection.request(method, route, body=payload, headers=headers)
            response = self.connection.getresponse()
            raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise RuntimeError('Oversized response')
            if response.status != 200 and not (response.status == 202 and method == 'POST' and route in ('/v1/native/rehearse','/v1/native/resume-managed','/v1/native/cleanup-restart','/v1/native/migrate','/v1/native/resume-native','/v1/native/return-managed')):
                raise OperationError(json.loads(raw))
            if raw_response:
                if len(raw) > 1024 * 1024 or hashlib.sha256(raw).hexdigest() != response.getheader('X-SHA256'):
                    raise RuntimeError('Download chunk digest mismatch')
                result = raw
            else:
                result = json.loads(raw)
            self.requests += 1
            self.last_response = time.monotonic()
            if response.will_close or not self.keep_alive:
                self.close()
            return result
        except Exception:
            self.failed = True
            self.close()
            raise


def request(config, method, route, body=None, *, binary=None, raw_response=False, timeout=40, session=None):
    if session is not None:
        if config != session.config:
            raise ValueError('Session destination or credentials differ')
        return session.request(method, route, body, binary=binary, raw_response=raw_response, timeout=timeout)
    with Session(config, keep_alive=False) as transport:
        return transport.request(method, route, body, binary=binary, raw_response=raw_response, timeout=timeout)


# Fixed budgets mirrored in service/operation-deadlines.js; the parity contract
# checks both implementations. These do not extend command or job run deadlines.
OPERATION_TIMEOUT_MS = {
    'file.open': 120000, 'file.commit': 120000, 'helper.prepare': 120000,
    'file.read': 60000, 'file.write': 60000,
}


def operation_timeout(op):
    return (OPERATION_TIMEOUT_MS.get(op, 30000) + 10000) / 1000


def operation(config, value, *, binary=None, session=None):
    envelope=dict(id=str(uuid.uuid4()), operation=value)
    route='/v1/files/write' if binary is not None else '/v1/files/read' if value['op']=='file.read' else '/v1/op'
    return request(config,'POST',route,envelope,binary=binary,raw_response=value['op']=='file.read',session=session,timeout=operation_timeout(value['op']))


def file_digest(stream):
    digest=hashlib.sha256()
    while True:
        data=stream.read(1024*1024)
        if not data:break
        digest.update(data)
    stream.seek(0)
    return digest.hexdigest()


def upload(config, source, target, expected_sha256='absent', transfer_id=None):
    with Session(config) as transport:
        with Path(source).open('rb') as stream:
            digest=file_digest(stream);size=os.fstat(stream.fileno()).st_size
            if transfer_id:
                session=operation(config,dict(op='file.status',transfer_id=transfer_id),session=transport)
                if not session.get('upload') or any(session.get(k)!=v for k,v in dict(path=target,size=size,sha256=digest,expected_sha256=expected_sha256).items()):
                    raise RuntimeError('Resume source or precondition differs from the existing upload')
            else:session=operation(config,dict(op='file.begin',path=target,size=size,sha256=digest,expected_sha256=expected_sha256),session=transport)
            transfer=session['transfer_id'];offset=session.get('offset',0)
            if offset<0 or offset>size:raise RuntimeError('Invalid resume offset')
            stream.seek(offset)
            print('Upload transfer: '+transfer,file=sys.stderr)
            while True:
                data=stream.read(session['chunk_bytes'])
                if not data:break
                result=operation(config,dict(op='file.write',transfer_id=transfer,offset=offset,sha256=hashlib.sha256(data).hexdigest()),binary=data,session=transport)
                offset+=len(data)
                if result.get('offset')!=offset:raise RuntimeError('Upload offset mismatch; inspect transfer status')
            return operation(config,dict(op='file.commit',transfer_id=transfer),session=transport)


def download(config, source, target):
    with Session(config) as transport:
        target=Path(target)
        if target.exists():raise FileExistsError(target)
        session=operation(config,dict(op='file.open',path=source),session=transport);transfer=session['transfer_id']
        temporary=target.with_name(target.name+'.part-'+uuid.uuid4().hex)
        print('Download transfer: '+transfer,file=sys.stderr)
        try:
            digest=hashlib.sha256();offset=0
            with temporary.open('xb') as stream:
                os.chmod(temporary,0o600)
                while offset<session['size']:
                    data=operation(config,dict(op='file.read',transfer_id=transfer,offset=offset,length=min(session['chunk_bytes'],session['size']-offset)),session=transport)
                    if not data or offset+len(data)>session['size']:raise RuntimeError('Invalid download length')
                    stream.write(data);digest.update(data);offset+=len(data)
                stream.flush();os.fsync(stream.fileno())
            if digest.hexdigest()!=session['sha256']:raise RuntimeError('Downloaded file changed or digest mismatch')
            os.link(temporary,target)  # Atomic publication without overwriting a local file.
            temporary.unlink()
        except Exception:
            # Preserve partial bytes and transfer ID for explicit diagnosis/resumption.
            print('Partial download: '+str(temporary),file=sys.stderr)
            raise
        operation(config,dict(op='file.close',transfer_id=transfer),session=transport)
        return dict(path=str(target),size=offset,sha256=digest.hexdigest())


def wait_ready(config, previous_boot_id=None, timeout=180):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            status=request(config,'GET','/v1/status',timeout=min(40,max(0.001,deadline-time.monotonic())))
            boot=status.get('boot_id')
            if boot and status.get('worker_ready') and status.get('identity',{}).get('uid')==0 and (previous_boot_id is None or boot!=previous_boot_id):return status
        except (OSError,TimeoutError):pass
        time.sleep(min(1,max(0,deadline-time.monotonic())))
    raise TimeoutError('No ready root worker on the requested boot before the deadline')


def probe_observer(config, manifest_sha256, request_id, session=None):
    if not isinstance(manifest_sha256,str) or not re.fullmatch('[a-f0-9]{64}',manifest_sha256):
        raise ValueError('Candidate manifest digest required')
    if not isinstance(request_id,str) or not re.fullmatch('[-a-zA-Z0-9]{16,64}',request_id):
        raise ValueError('Persistent request ID required')
    return request(config,'POST','/v1/observer/probe',dict(id=request_id,manifest_sha256=manifest_sha256),timeout=130,session=session)



def rehearse_native(config, manifest_sha256, runtime_sha256, request_id, session=None):
    if not all(isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v) for v in (manifest_sha256,runtime_sha256)):
        raise ValueError('Candidate and managed runtime digests required')
    if not isinstance(request_id,str) or not re.fullmatch('[-a-zA-Z0-9]{16,64}',request_id):
        raise ValueError('Persistent request ID required')
    return request(config,'POST','/v1/native/rehearse',dict(id=request_id,manifest_sha256=manifest_sha256,runtime_sha256=runtime_sha256),session=session)


def resume_managed_activation(config, rehearsal_id, request_id, session=None):
    if not all(isinstance(v,str) and re.fullmatch('[-a-zA-Z0-9]{16,64}',v) for v in (rehearsal_id,request_id)) or rehearsal_id == request_id:
        raise ValueError('Distinct rehearsal and recovery request IDs required')
    return request(config,'POST','/v1/native/resume-managed',dict(id=request_id,rehearsal_id=rehearsal_id),session=session)


def migrate_native(config, manifest_sha256, runtime_sha256, request_id, session=None):
    if not all(isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v) for v in (manifest_sha256,runtime_sha256)):
        raise ValueError('Candidate and managed runtime digests required')
    if not isinstance(request_id,str) or not re.fullmatch('[-a-zA-Z0-9]{16,64}',request_id):
        raise ValueError('Persistent request ID required')
    return request(config,'POST','/v1/native/migrate',dict(id=request_id,manifest_sha256=manifest_sha256,runtime_sha256=runtime_sha256),session=session)


def resume_native_activation(config, migration_id, request_id, session=None):
    if not all(isinstance(v,str) and re.fullmatch('[-a-zA-Z0-9]{16,64}',v) for v in (migration_id,request_id)) or migration_id == request_id:
        raise ValueError('Distinct migration and recovery request IDs required')
    return request(config,'POST','/v1/native/resume-native',dict(id=request_id,migration_id=migration_id),session=session)


def return_managed(config, runtime_sha256, request_id, session=None):
    if not isinstance(runtime_sha256,str) or not re.fullmatch('[a-f0-9]{64}',runtime_sha256):
        raise ValueError('Managed runtime digest required')
    if not isinstance(request_id,str) or not re.fullmatch('[-a-zA-Z0-9]{16,64}',request_id):
        raise ValueError('Persistent request ID required')
    return request(config,'POST','/v1/native/return-managed',dict(id=request_id,runtime_sha256=runtime_sha256),session=session)


def cleanup_restart(config, transaction_id, request_id, session=None, *, cleanup_id=None):
    if not isinstance(transaction_id,str) or not re.fullmatch('[a-f0-9]{32}',transaction_id) or not isinstance(request_id,str) or not re.fullmatch('[-a-zA-Z0-9]{16,64}',request_id):
        raise ValueError('Rolled-back transaction and persistent request ID required')
    value=dict(id=request_id,transaction_id=transaction_id)
    if cleanup_id is not None:
        if not isinstance(cleanup_id,str) or not re.fullmatch(r'[-a-zA-Z0-9]{16,64}',cleanup_id) or cleanup_id==request_id: raise ValueError('Distinct original cleanup ID required')
        value['cleanup_id']=cleanup_id
    return request(config,'POST','/v1/native/cleanup-restart',value,session=session)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True,type=Path)
    parser.add_argument('--cleanup-id',help='Original unknown cleanup request to reconcile (same live coordinator)')
    parser.add_argument('operation',choices=['status','requests','enable','disable','exec','archive-journal','upload','download','op','wait-ready','app-exec','job-start','job-status','job-tail','job-cancel','job-forget','helper-prepare','helper-release','observer-probe','native-rehearse','native-status','native-resume-managed','native-cleanup-restart','native-migrate','native-resume-native','native-return-managed'])
    parser.add_argument('--manifest-sha256');parser.add_argument('--runtime-sha256');parser.add_argument('--rehearsal-id');parser.add_argument('--migration-id');parser.add_argument('--transaction-id')
    parser.add_argument('--command-file',type=Path)
    parser.add_argument('--timeout-ms',type=int,default=20000)
    parser.add_argument('--request-id',default=None)
    parser.add_argument('--transfer-id');parser.add_argument('--job-id');parser.add_argument('--helper-id')
    parser.add_argument('--sha256');parser.add_argument('--profile',choices=['root','app'],default='root')
    parser.add_argument('--stdout-cursor',type=int,default=0);parser.add_argument('--stderr-cursor',type=int,default=0)
    parser.add_argument('--source');parser.add_argument('--target')
    parser.add_argument('--expected-sha256',default='absent')
    parser.add_argument('--operation-file',type=Path)
    parser.add_argument('--previous-boot-id');parser.add_argument('--wait-seconds',type=float,default=180)
    args=parser.parse_args();config=json.loads(args.config.read_text())
    if args.operation in ('upload','download'):
        if not args.source or not args.target:parser.error('--source and --target required')
        result=upload(config,args.source,args.target,args.expected_sha256,args.transfer_id) if args.operation=='upload' else download(config,args.source,args.target)
    elif args.operation=='app-exec' or args.operation.startswith('job-'):
        name='app.exec' if args.operation=='app-exec' else 'job.'+args.operation[4:].replace('tail','output')
        value=dict(op=name)
        if name.startswith('job.'):
            if not args.job_id and name!='job.start':parser.error('--job-id required')
            value['id']=args.job_id or str(uuid.uuid4())
        if name in ('app.exec','job.start'):
            if not args.command_file:parser.error('--command-file required')
            value.update(command=args.command_file.read_text(),timeout_ms=args.timeout_ms)
            if name=='job.start':value['profile']=args.profile
        if name=='job.output':value.update(stdout_cursor=args.stdout_cursor,stderr_cursor=args.stderr_cursor)
        result=operation(config,value)
    elif args.operation.startswith('helper-'):
        if args.operation=='helper-prepare':
            if not args.source or not args.sha256:parser.error('--source and --sha256 required')
            value=dict(op='helper.prepare',path=args.source,sha256=args.sha256)
        else:
            if not args.helper_id:parser.error('--helper-id required')
            value=dict(op='helper.release',helper_id=args.helper_id)
        result=operation(config,value)
    elif args.operation=='op':
        if not args.operation_file:parser.error('--operation-file required')
        result=operation(config,json.loads(args.operation_file.read_text()))
    elif args.operation=='native-status':result=request(config,'GET','/v1/native/status')
    elif args.operation=='native-rehearse':
        if not args.manifest_sha256 or not args.runtime_sha256 or not args.request_id:parser.error('--manifest-sha256, --runtime-sha256 and --request-id required')
        print('Request ID: '+args.request_id,file=sys.stderr)
        result=rehearse_native(config,args.manifest_sha256,args.runtime_sha256,args.request_id)
    elif args.operation=='native-resume-managed':
        if not args.rehearsal_id or not args.request_id:parser.error('--rehearsal-id and --request-id required')
        print('Request ID: '+args.request_id,file=sys.stderr)
        result=resume_managed_activation(config,args.rehearsal_id,args.request_id)
    elif args.operation=='native-migrate':
        if not args.manifest_sha256 or not args.runtime_sha256 or not args.request_id:parser.error('--manifest-sha256, --runtime-sha256 and --request-id required')
        print('Request ID: '+args.request_id,file=sys.stderr)
        result=migrate_native(config,args.manifest_sha256,args.runtime_sha256,args.request_id)
    elif args.operation=='native-resume-native':
        if not args.migration_id or not args.request_id:parser.error('--migration-id and --request-id required')
        print('Request ID: '+args.request_id,file=sys.stderr)
        result=resume_native_activation(config,args.migration_id,args.request_id)
    elif args.operation=='native-return-managed':
        if not args.runtime_sha256 or not args.request_id:parser.error('--runtime-sha256 and --request-id required')
        print('Request ID: '+args.request_id,file=sys.stderr)
        result=return_managed(config,args.runtime_sha256,args.request_id)
    elif args.operation=='native-cleanup-restart':
        if not args.transaction_id or not args.request_id:parser.error('--transaction-id and --request-id required')
        print('Request ID: '+args.request_id,file=sys.stderr)
        result=cleanup_restart(config,args.transaction_id,args.request_id,cleanup_id=args.cleanup_id)
    elif args.operation=='observer-probe':
        if not args.manifest_sha256:parser.error('--manifest-sha256 required')
        identity=args.request_id or str(uuid.uuid4())
        print('Request ID: '+identity,file=sys.stderr)
        result=probe_observer(config,args.manifest_sha256,identity)
    elif args.operation=='wait-ready':result=wait_ready(config,args.previous_boot_id,args.wait_seconds)
    elif args.operation=='exec':
        if not args.command_file:parser.error('exec requires --command-file')
        value=dict(id=args.request_id or str(uuid.uuid4()),command=args.command_file.read_text(),timeout_ms=args.timeout_ms)
        print('Request ID: '+value['id'],file=__import__('sys').stderr)
        result=request(config,'POST','/v1/exec',value)
    elif args.operation=='archive-journal':
        snapshot=request(config,'GET','/v1/requests')
        if 'sha256' not in snapshot:raise RuntimeError('Installed agent does not support journal archiving')
        result=request(config,'POST','/v1/journal/archive',{'expected_sha256':snapshot['sha256']})
    elif args.operation in ('enable','disable'):result=request(config,'POST','/v1/'+args.operation,{})
    else:result=request(config,'GET','/v1/'+args.operation)
    if isinstance(result,bytes):
        if not args.target:parser.error('Binary operation requires --target for the returned range')
        with Path(args.target).open('xb') as output:output.write(result)
    else:print(json.dumps(result,indent=2))

if __name__=='__main__':main()
