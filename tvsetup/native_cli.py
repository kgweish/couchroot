"""Explicit native install/recovery commands. Importing this module is offline."""
import contextlib
import json
from pathlib import Path
import sys
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler

from .common import STATE, Refused, atomic_json, lock, read_json, safe_id, sha
from .engine import pending, run_id
from .native_hook import SCOPE, read_bounded
from .native_install import capture, engine_for, RemoteIO
from .site import load_site, configured_profile, binding
from .planner import Action


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Refused('TV identity endpoint redirected; no agent operation submitted')


def identity(profile):
    # Match the existing toolkit's model/platform/UUID checks, without starting an
    # SDB connection. Root-agent TLS is independently pinned afterwards.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open('http://'+profile['host']+':8001/api/v2/', timeout=5) as response:
        raw = response.read(65537)
    if len(raw) > 65536:raise Refused('Oversized TV identity response')
    data = json.loads(raw).get('device', {})
    expected = {'modelName': profile['model'], 'model': profile['platform'], 'id': profile['device_id']}
    if any(data.get(k) != v for k, v in expected.items()):
        raise Refused('Physical TV identity differs; no agent operation submitted')


def agent_binding(site, device, path):
    config = json.loads(read_bounded(path).decode())
    if config.get('device') != device or config.get('host') != site['devices'][device]['host']:
        raise Refused('Agent enrollment differs from site identity')
    from .native_hook import digest
    digest(config.get('server_sha256'))
    if type(config.get('port')) is not int or not 1 <= config['port'] <= 65535:
        raise Refused('Invalid agent enrollment port')
    value = {'site': binding(site, device), 'host': config['host'], 'port': config['port'],
             'server': config['server_sha256'],
             'client': sha(read_bounded(Path(config['client_certificate']).expanduser()))}
    return sha(json.dumps(value, sort_keys=True).encode())


def connect(profile, folder, agent):
    identity(profile)
    from .agent_transport import AgentTransport
    return RemoteIO(AgentTransport(profile, folder/'transport', agent))


def result(doc, **extra):
    telemetry = any(row['action']['component'] == 'telemetry' for row in doc['actions'])
    recovery = ('Restore boot hook, revoke telemetry admission, stop the captured collector and restore managed selection. Managed transmission needs the normal Hub settings control; staged files and preferences retained.' if telemetry else 'Hook configuration only; staged files and preferences retained. No process stop, source repair or reboot.')
    return {'device': 'qn90a', 'launcher': 'native', 'run': doc['run'], 'phase': doc['phase'],
            'scope': SCOPE, 'hardware_verified': False,
            'recovery': recovery, 'native_telemetry': telemetry, **extra}


def emit(value, args):
    if args.json:print(json.dumps(value, indent=2))
    else:
        for key, item in value.items():print(key+': '+str(item))


def load_run(folder):
    doc = read_json(folder/'journal.json')
    if not doc or doc.get('scope') != SCOPE or doc.get('device') != 'qn90a' or doc.get('run') != folder.name or len(doc.get('actions', [])) not in (1, 2):
        raise Refused('Not a native launcher run; use the original entry point for private trials')
    # The journal carries immutable capture metadata. Do not read bundle paths or
    # the original enrollment; they may have been deleted since preparation.
    return doc, doc['actions'][0]['info']


def main(args):
    if getattr(args, 'activate', False):
        raise Refused('Native apply stages next-boot configuration; --activate is web-only')
    if args.command in ('status', 'verify') and not args.run:
        raise Refused('Native status/verify requires --run RUN_ID')
    if args.command in ('resume', 'rollback', 'status', 'verify') and (args.bundle or args.hook_config or args.source_rearm):
        raise Refused('Recovery/verification uses captured inputs; do not provide a new bundle, enrollment or source policy')
    if args.command in ('apply', 'inspect') and (not args.bundle or not args.hook_config):
        raise Refused('Native apply/inspect requires --bundle DIR and --hook-config FILE')
    if args.command != 'status' and not args.agent:
        raise Refused('Native device operations require explicit --agent FILE enrollment')
    if args.command in ('apply', 'resume', 'rollback') and (args.non_interactive or args.json) and not args.yes:
        raise Refused('Noninteractive/JSON mutations require --yes')
    folder = None
    try:
        with contextlib.ExitStack() as stack:
            # Same lock as web setup and root trials. Read-only status can inspect
            # an atomic journal without opening a connection or private site file.
            if args.command == 'status':
                folder = STATE/'runs'/safe_id(args.run)
                doc, _ = load_run(folder)
                emit(result(doc, offline=True), args)
                return 0
            stack.enter_context(lock(STATE/'qn90a.lock'))
            stack.enter_context(lock(STATE/'shared-nas.lock'))
            site = load_site(args.site)
            profile = configured_profile('qn90a', site)
            target = agent_binding(site, 'qn90a', args.agent.expanduser())
            if args.command in ('resume', 'rollback', 'verify'):
                folder = STATE/'runs'/safe_id(args.run)
                doc, info = load_run(folder)
                if doc.get('target_binding') != target:raise Refused('Run destination or agent/signing trust differs')
                local_only = (args.command == 'resume' and doc['phase'] in ('configuration-applied', 'finalizing')) or (args.command == 'rollback' and all(row['phase'] in ('planned','prepared','backing-up','backed-up','rolled-back') for row in doc['actions']))
                driver, engine = engine_for(None, folder, info, target, STATE)
                if [Action(**row['action']) for row in doc['actions']] != driver.proposal().actions:
                    raise Refused('Native journal actions differ from captured transaction')
                engine.load()
                if args.command in ('resume', 'rollback'):
                    from .planner import source_revision
                    if doc['source_revision'] != source_revision():
                        raise Refused('Source changed since this run; recover with its original checkout')
                if not local_only:driver.io = connect(profile, folder, args.agent)
                if args.command == 'verify':
                    restored = engine.doc['phase'] == 'rolled-back'
                    if restored:driver.verify_restored()
                    else:
                        for action in driver.proposal().actions:driver.verify(action, {}, driver.snapshot())
                    emit(result(engine.doc, configuration_verified=True, configuration='baseline-restored' if restored else 'native-installed'), args)
                    return 0
                from .cli import accept
                accept(args)
                if args.command == 'rollback':
                    engine.rollback()
                else:
                    engine.reconcile(args.retry_unchanged)
                    # Engine's generic already-applied shortcut checks the hook
                    # value; native also checks every payload before finalization.
                    if not local_only:
                        for row in engine.doc['actions']:
                            if row['phase'] == 'applied':driver.verify(Action(**row['action']), {}, driver.snapshot())
                    engine.apply();engine.finalize()
                emit(result(engine.doc), args)
                return 0
            if pending(STATE, 'qn90a'):
                raise Refused('Reconcile the pending setup/native run before starting another')
            folder = STATE/('runs' if args.command == 'apply' else 'inspections')/run_id()
            info = capture(folder, args.bundle, args.hook_config, args.source_rearm,
                           ledger=read_json(STATE/'qn90a-ledger.json'))
            # Parsing, hashing and capturing finish before the first connection.
            io = connect(profile, folder, args.agent)
            driver, engine = engine_for(io, folder, info, target, STATE)
            driver.preflight()
            state = driver.snapshot()
            proposal = driver.proposal()
            if args.command == 'inspect':
                emit({'device':'qn90a', 'launcher':'native', 'configuration_ready':True,
                      'hardware_verified':False, 'actions':proposal.json()['actions']}, args)
                return 0
            engine.prepare(proposal, state)
            if not args.json:
                if driver.telemetry:print('Handoff telemetry to the native collector now; keep the signed adapter and pairing. Launcher changes take effect at next boot.')
                print('Install native next-boot hook; keep web fallback, retain original hook/dependencies and preserve preferences. No launch or reboot.')
            from .cli import accept
            try:accept(args)
            except BaseException:
                engine.doc['phase'] = 'cancelled';engine.save();raise
            engine.apply();engine.finalize()
            emit(result(engine.doc), args)
            return 0
    except BaseException as error:
        if folder is not None and args.command != 'status':
            with contextlib.suppress(Exception):
                atomic_json(folder/'error.json', {'type':type(error).__name__, 'detail':str(error)})
            print('Private native run: '+str(folder), file=sys.stderr)
        if isinstance(error, (Refused, KeyboardInterrupt)):raise
        raise Refused('Native operation failed; inspect the private journal and reconcile before retrying') from None
