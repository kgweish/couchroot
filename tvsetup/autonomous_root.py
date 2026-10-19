"""Prepare per-TV autonomous administration artifacts. No device mutation.

Uses the setup Builder and pinned signature verifier. Installed boot behavior and
SDK loopback admission require a separate, journaled on-device acceptance trial.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import ssl
import sys
import xml.etree.ElementTree as ET
from .artifacts import Builder, verify_package, require_trust
from .common import PRIVATE, REPO, Refused, atomic_json, run, sha
from .engine import run_id
from .root import LAUNCHER
from .site import load_site, configured_profile, binding

SOURCE=REPO/'research/autonomous-root'
PACKAGE='MiniRoot01'


def certificate(builder, folder, name):
    key,cert=folder/(name+'-key.pem'),folder/(name+'.pem')
    builder.command(['openssl','req','-x509','-newkey','rsa:2048','-sha256','-nodes',
        '-keyout',key,'-out',cert,'-days','365','-subj','/CN=minimal-tv-'+name,
        '-addext','basicConstraints=critical,CA:TRUE',
        '-addext','keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
        '-addext','extendedKeyUsage='+('serverAuth' if name=='server' else 'clientAuth')])
    key.chmod(0o600);cert.chmod(0o600)
    return sha(ssl.PEM_cert_to_DER_cert(cert.read_text()))


def prepare(device, site, sign=True, version=None, native_candidate=False, native_acquisition=False):
    profile=configured_profile(device,site)
    if sign:require_trust(profile)
    folder=PRIVATE/'autonomous-root'/device/run_id();folder.mkdir(parents=True,mode=0o700)
    builder=Builder(profile,{},folder/'build')
    stage=folder/'package';stage.mkdir(mode=0o700)
    for name in ('config.xml','index.html'):shutil.copyfile(SOURCE/name,stage/name)
    if version:
        import re
        if not re.fullmatch(r'\d{1,5}\.\d{1,5}\.\d{1,5}',version):raise Refused('Invalid version')
        p=stage/'config.xml';p.write_text(p.read_text().replace('version="0.1.0"','version="'+version+'"'))
    shutil.copytree(SOURCE/'service',stage/'service')
    payload=stage/'payload';payload.mkdir(mode=0o700)
    if native_acquisition and not native_candidate:
        raise Refused("Native service acquisition requires the native candidate")
    if native_candidate:
        from .native_worker import ARTIFACTS, build as build_native
        native = build_native(folder/'native-worker-candidate', builder.command)
        launcher = native/'native-app-launcher'
        for name in (*ARTIFACTS, 'native-manifest.json'):
            shutil.copyfile(native/name, payload/name)
    else:
        from .root_launcher import build as build_launcher
        launcher = build_launcher(folder/'native-app-launcher', builder.command)
    for name in ('SamsungTvRootAgent','SamsungTvArchiveRoot'):
        output=folder/'compiled'/name
        builder.build_managed(SOURCE/'payload'/(name+'.csproj'),output,
                              native_app_launcher=launcher if name=='SamsungTvRootAgent' else None)
        for suffix in ('dll','deps.json','runtimeconfig.json'):
            shutil.copyfile(output/(name+'.'+suffix),payload/(name+'.'+suffix))
    if native_acquisition:
        from .native_root import build as build_acquisition, FILES
        bundle = folder/'native-service-acquisition'
        acquisition = build_acquisition(profile, bundle, builder.command, service=True)
        for name in FILES:
            shutil.copyfile(bundle/'artifacts'/name, payload/name)
        atomic_json(payload/'service-acquisition.json', acquisition)
    atomic_json(payload/'manifest.json',{p.name:sha(p.read_bytes()) for p in payload.iterdir()})
    shutil.copyfile(SOURCE/'payload/LICENSE',payload/'LICENSE')
    shutil.copyfile(SOURCE/'UPSTREAM.json',stage/'UPSTREAM.json')
    credentials=folder/'credentials';credentials.mkdir(mode=0o700)
    server_pin=certificate(builder,credentials,'server');client_pin=certificate(builder,credentials,'client')
    provision=folder/'provision';provision.mkdir(mode=0o700)
    for name in ('server-key.pem','server.pem','client.pem'):
        shutil.copyfile(credentials/name,provision/name);(provision/name).chmod(0o600)
    hashes={'/usr/bin/dotnet':profile['host_sha256'],'/usr/sbin/sdbd-tarlauncher':LAUNCHER[device]}
    if profile.get('launcher_sha256'):hashes['/usr/bin/dotnet-launcher']=profile['launcher_sha256']
    atomic_json(provision/'config.json',dict(schema=1,device=device,enabled=False,port=28443,
        firmware=profile['firmware'],hashes=hashes,client_sha256=client_pin))
    atomic_json(folder/'client.json',dict(schema=1,device=device,host=profile['host'],port=28443,
        server_sha256=server_pin,server_certificate=str(credentials/'server.pem'),
        client_certificate=str(credentials/'client.pem'),client_key=str(credentials/'client-key.pem')))
    package=None
    if sign:
        builder.command([builder.cli,'package','-t','wgt','-s',profile['signing_profile'],'-o',stage,'--',stage])
        candidates=list(stage.glob('*.wgt'))
        if len(candidates)!=1:raise Refused('Expected exactly one signed root-agent package')
        package=folder/(PACKAGE+'.wgt');shutil.move(candidates[0],package)
        members,version=verify_package(package,profile,PACKAGE)
        if any(n.endswith('-key.pem') or n=='client.json' for n in members):raise Refused('Private provisioning material entered package')
    atomic_json(folder/'manifest.json',dict(schema=1,device=device,target_binding=binding(site,device),
        phase='prepared-not-installed',framework=profile['framework'],package=str(package) if package else None,
        package_sha256=sha(package.read_bytes()) if package else None,
        files={str(p.relative_to(stage)):sha(p.read_bytes()) for p in stage.rglob('*') if p.is_file()},
        provisioning={p.name:sha(p.read_bytes()) for p in provision.iterdir()},
        source={str(p.relative_to(SOURCE)):sha(p.read_bytes()) for p in SOURCE.rglob('*') if p.is_file() and not {'obj','bin'}&set(p.relative_to(SOURCE).parts)}))
    return dict(device=device,phase='prepared-not-installed',folder=str(folder),package=str(package) if package else None)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device',choices=['qn90a','s90d'],required=True)
    parser.add_argument('--native-candidate',action='store_true',help='Include reproducible native artifacts; managed remains selected')
    parser.add_argument('--native-acquisition', action='store_true', help='Use native service acquisition and held bootstrap; keep managed fallback')
    parser.add_argument('--version');parser.add_argument('--site',type=Path);parser.add_argument('--unsigned',action='store_true')
    args=parser.parse_args()
    try:print(json.dumps(prepare(args.device,load_site(args.site),not args.unsigned,args.version,args.native_candidate,args.native_acquisition)))
    except Refused as e:print(str(e),file=sys.stderr);return 1
    return 0

if __name__=='__main__':sys.exit(main())
