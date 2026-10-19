"""Build a bounded operation using the tracked model-specific namespace probes.

No private dump collector, deployed artifacts or historical backup is imported.
The baseline invocation reports identity only; the script runs only at uid 0.
This orchestration requires physical validation on each supported firmware.
"""
import base64
import io
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
from .common import PRIVATE, REPO, Refused, lock, run, sha
from .transport import managed_guard, hash_guard, Q
from .toolkit import load

BASE = '/home/owner/share/tmp/sdk_tools/'
LAUNCHER = {
    'qn90a': '3580e6dcf5d9c6d5d0a606d43a3d878641f35eeac07317a405fb45bbed69a653',
    's90d': '607e2991160449c0e5fb3acbdef1e47ac761086e5ad8942fff8a9725633ae20e',
}
OPERATION = '''using System;using System.IO;using System.Diagnostics;using System.Runtime.InteropServices;
class RootIdentity {
[DllImport("libc.so.6")]static extern uint getuid();
static int Main(){foreach(string l in File.ReadLines("/proc/self/status"))if(l.StartsWith("Uid:"))Console.WriteLine(l);if(getuid()!=0)return 0;
var p=new ProcessStartInfo("/bin/sh"){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};p.ArgumentList.Add("-c");p.ArgumentList.Add(System.Text.Encoding.UTF8.GetString(Convert.FromBase64String("PAYLOAD")));
using(var c=Process.Start(p)){var o=c.StandardOutput.ReadToEndAsync();var e=c.StandardError.ReadToEndAsync();if(!c.WaitForExit(25000)){c.Kill(true);return 9;}Console.Write(o.Result);Console.Write(e.Result);return c.ExitCode;}}
}'''


def operation_source(script):
    return OPERATION.replace('PAYLOAD', base64.b64encode(script.encode()).decode())


def build(profile, folder, script, cleanup_index=None):
    folder = folder.resolve()
    framework = profile['framework']
    defines = 'QN90A' if profile['id'] == 'qn90a' else ''
    outputs = {}
    for name in ('NamespaceRootProbe', 'RootIdentity'):
        project = folder / name; project.mkdir()
        if name == 'NamespaceRootProbe':
            source = (REPO / 'research/namespace-root-probe/Program.cs').read_text()
        elif cleanup_index is None:
            source = operation_source(script)
        else:
            if profile['id'] != 'qn90a' or type(cleanup_index) is not int or not 0 <= cleanup_index < 10:
                raise Refused('Invalid reviewed QN90A cleanup target')
            source = (REPO / 'research/qn90a-app-cleanup/Program.cs').read_text()
            defines = 'HOME_CLEANUP_' + str(cleanup_index)
        (project / 'Program.cs').write_text(source)
        csproj = project / (name + '.csproj')
        csproj.write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                         '<TargetFramework>'+framework+'</TargetFramework><OutputType>Exe</OutputType>'
                         '<UseAppHost>false</UseAppHost><CheckEolTargetFramework>false</CheckEolTargetFramework>'
                         '<DefineConstants>'+defines+'</DefineConstants></PropertyGroup></Project>')
        run(['dotnet', 'build', csproj, '-c', 'Release', '--nologo', '-v', 'quiet', '-p:Deterministic=true', '-p:PathMap='+str(project)+'=/src/'+name], timeout=120)
        outputs[project / 'bin/Release' / framework / (name+'.dll')] = name+'.dll'
    return outputs


def execute(profile, script, cleanup_index=None, *, native_bundle=None):
    toolkit = load()
    cfg = dict(tv_host=profile['host'], expected_model=profile['model'], expected_platform=profile['platform'],expected_device_id=profile['device_id'])
    probe = 'codex-qn90a-root-proof' if profile['id']=='qn90a' else 'codex-namespace-proof'
    if native_bundle is not None:
        from . import native_root
        probe = native_root.probe_name(profile)
    prefix = BASE+probe
    guards = managed_guard(profile)+hash_guard('/usr/sbin/sdbd-tarlauncher', LAUNCHER[profile['id']])
    with lock(PRIVATE/(profile['id']+'-root-check.lock')), tempfile.TemporaryDirectory(prefix='setup-root-', dir=PRIVATE) as tmp:
        folder = Path(tmp)
        # Compile and sign locally before even creating target staging directories.
        outputs = (build(profile,folder,guards+script,cleanup_index) if native_bundle is None else
                   native_root.prepare(profile,native_bundle,folder,guards+script,cleanup_index))
        artifacts = {p:probe+'/'+name for p,name in outputs.items()}
        archive = folder/(probe+'.tar.gz')
        with tarfile.open(archive,'w:gz') as tar:
            payload=b'Authorized bounded setup operation.\n';entry=tarfile.TarInfo('identity-proof.txt')
            entry.size=len(payload);entry.mode=0o644;tar.addfile(entry,io.BytesIO(payload))
        private=folder/'test-private.pem';public=folder/'public.pem';signature=folder/(archive.name+'.signature')
        run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',private])
        run(['openssl','pkey','-in',private,'-pubout','-out',public])
        run(['openssl','dgst','-sha256','-sign',private,'-out',signature,archive])
        run(['openssl','dgst','-sha256','-verify',public,'-signature',signature,archive])
        artifacts.update({public:probe+'/public.pem',archive:'on-demand/'+archive.name,signature:'on-demand/'+signature.name})
        callback=toolkit.device(cfg)
        client=toolkit.SdbClient(PRIVATE/'bin/sdb',profile['host']);client.connect();client.require_device()
        # Originals are captured afresh; no dependency on another TV's passwd hash.
        original=client.capture('(\n'+guards+'sha256sum /etc/passwd /usr/share/sdbd/public.pem\n)',callback_host=callback,bind_host=callback,timeout=15)
        import re
        hashes={m[2]:m[1] for m in re.finditer(r'(?m)^([a-f0-9]{64})  (/\S+)$',original.output)}
        if original.transport_returncode not in (0,1) or not re.search(r'\n\[exit:0\]\s*\Z',original.output) or set(hashes)!={'/etc/passwd','/usr/share/sdbd/public.pem'}:
            raise Refused('Cannot verify original root-transport resources')
        originals=''.join(hash_guard(p,h) for p,h in hashes.items())
        stage=guards+originals+f'test ! -e {prefix} && test ! -L {prefix}\ntest ! -e {BASE}on-demand && test ! -L {BASE}on-demand\nmkdir {prefix} {BASE}on-demand\n'
        if native_bundle is not None:
            stage+=f'mkdir {prefix}/code\n'
        toolkit.capture(cfg,callback,stage,20,'setup-root-stage')
        cleanup='\n'.join('rm -f '+Q(BASE+v) for v in artifacts.values())
        if native_bundle is not None:
            cleanup+=f'\nif test -d {prefix}/code; then rmdir {prefix}/code; fi\n'
        cleanup+=f'\nrm -f {prefix}/passwd-view\nfor d in {prefix} {BASE}on-demand; do if test -d "$d"; then rmdir "$d"; fi; done\n'
        try:
            for source,target in artifacts.items():client.push(source,PurePosixPath(BASE+target))
            check=''.join(hash_guard(BASE+target,sha(source.read_bytes())) for source,target in artifacts.items())
            command=guards+originals+"cleanup() {\n"+cleanup+"}\ntrap cleanup EXIT\n"+check
            if native_bundle is None:
                command+=f'/usr/bin/dotnet {prefix}/NamespaceRootProbe.dll {prefix}\n'
            else:
                command+=f'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus /usr/bin/dotnet {prefix}/NativeEntry.dll probe\n'
            toolkit.capture(cfg,callback,command,45,'setup-root-operation')
        finally:
            # Only known temporary files; never retry the operation on an uncertain result.
            toolkit.capture(cfg,callback,'set -eu\n'+cleanup+originals+
                            f'test ! -e {prefix}\ntest ! -e {BASE}on-demand\n'
                            'if ps -eo args | grep -E "[N]amespaceRootProbe.dll|[R]ootIdentity.dll|[N]ativeEntry.dll"; then exit 1; fi\n',20,'setup-root-cleanup')
