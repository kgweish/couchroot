"""One concise proposal; no per-setting questions or implicit reboots."""
import argparse
import contextlib
import json
import errno
import os
from pathlib import Path
import sys
import time
from .common import STATE, Refused, DeadlineExpired, atomic_json, lock, read_json, safe_id
from .config import COMPONENTS, LAUNCHER_COMPONENTS, profile, resolve, selected
from .engine import Engine, pending, run_id
from .nas import NAS
from .operations import Driver
from .planner import plan, order_actions, Action
from .transport import Transport
from .site import load_site, configured_profile, binding
from .observation import observe


def parser():
    p=argparse.ArgumentParser(description=__doc__)
    from . import __version__
    p.add_argument("--version",action="version",version="tv-setup "+__version__)
    sub=p.add_subparsers(dest='command',required=True)
    for name in ('plan','apply','status','verify','rollback'):
        c=sub.add_parser(name)
        c.add_argument('--site',type=Path,help='Private connection/trust config; defaults to TV_SETUP_SITE or ~/.config/samsung-tv-hub/site.json')
        c.add_argument('--device',choices=('qn90a','s90d'),required=True)
        c.add_argument('--json',action='store_true',help='Machine-readable summary (never credentials/raw evidence)')
        c.add_argument('--privileged-inspection',action='store_true',help='Read private state through the bounded temporary root transport')
        if name!='rollback':
            c.add_argument('--config',type=Path,help='JSON choices; overrides saved choices')
            c.add_argument('--preset',choices=('recommended',),default='recommended')
            c.add_argument('--components',help='Comma-separated selection; dependencies must be correct or selected')
            c.add_argument('--exclude',help='Comma-separated exclusions')
            c.add_argument('--keep',help='Comma-separated reviewed optional package IDs')
            c.add_argument('--remove',help='Comma-separated reviewed optional package IDs')
            c.add_argument('--telemetry-enabled',choices=('true','false','preserve'))
            c.add_argument('--artifact',action='append',default=[],metavar='NAME=PATH',help='Override a private artifact path; signatures and content guards still apply')
            c.add_argument('--endpoint',help='Pinned HTTPS receiver endpoint for this device')
            c.add_argument('--shared-nas',action='store_true',help='Authorize managed receiver/dashboard code changes for BOTH TVs')
        if name in ('apply','rollback'):
            c.add_argument('--yes',action='store_true',help='Accept the single proposed-change summary')
            c.add_argument('--non-interactive',action='store_true',help='Fail instead of prompting; use with --yes')
        if name=='apply':
            c.add_argument('--resume',help='Reconcile this incomplete run before continuing')
            c.add_argument('--retry-unchanged',action='store_true',help='Explicitly retry an uncertain action only after unchanged state and idle installer checks')
            c.add_argument('--activate',action='store_true',help='Refresh Hub/S90D helper after applying; this is not autonomous boot verification')
        if name=='verify':
            c.add_argument('--reboot',action='store_true',help='Explicitly request ONE full reboot and observe startup without launching Hub')
            c.add_argument('--wait-seconds',type=int,default=180,help='Reboot observation deadline, 30..300 seconds')
        if name=='rollback':c.add_argument('--run',required=True,help='Private run ID to roll back')
    return p


def summary(plan_value,as_json=False,extra=None):
    data=plan_value.json()
    if extra:data.update(extra)
    if as_json:print(json.dumps(data,indent=2));return
    print(plan_value.device+': '+', '.join(k+' '+v for k,v in plan_value.states.items()))
    counts={}
    for a in plan_value.actions:counts[a.component]=counts.get(a.component,0)+1
    print('Proposed changes: '+(', '.join(k+' ('+str(n)+')' for k,n in counts.items()) or 'none')+'.')
    for c in plan_value.states:print('  '+c+': '+plan_value.reasons.get(c,''))
    removes=[a.options['package'] for a in plan_value.actions if a.kind=='uninstall']
    if removes:
        names=profile(plan_value.device)['cleanup']
        print('  Remove reviewed optional apps: '+', '.join(names[p]['name']+' ('+p+')' for p in removes)+'. Store/signed-package recovery may be required.')
    for a in plan_value.actions:
        if a.kind=='pairing':print('  Pair this TV with its existing NAS credential and certificate; NAS credentials stay unchanged.')
        if a.kind=='preferences':print('  Telemetry: enabled='+str(a.after['enabled']).lower()+', endpoint='+a.after['endpoint'])
        if a.kind in ('setting','home_operation'):print('  '+a.options.get('key','Native Home')+': '+str(a.before)+' → '+str(a.after))
    if 'dashboard' in counts:print('  Shared NAS: receiver/dashboard code for BOTH TVs; preserve compose, pairing and history.')
    for issue in plan_value.issues:print('  Blocked: '+issue)
    if extra:
        for key,value in extra.items():print(key+': '+(value if isinstance(value,str) else json.dumps(value)))


def accept(args):
    if args.yes:return
    if args.non_interactive or not sys.stdin.isatty():raise Refused('Noninteractive changes require --yes')
    if input('Apply this summary? [y/N] ').strip().lower() not in ('y','yes'):raise Refused('Cancelled before changes')


def verification(profile_value,state,components=None):
    results={}
    try:telemetry=json.loads(state['telemetry_status'])
    except (ValueError,TypeError):telemetry={}
    enabled=(state.get('preferences') or {}).get('enabled',True)
    results['telemetry']='disabled by saved TV preference' if not enabled else 'fresh collector not observed'
    if enabled and telemetry.get('boot')==state['boot'] and telemetry.get('sent',0)>0 and 0<=state['uptime']-telemetry.get('uptime',-1000)<=90 and telemetry.get('monitoring') is True and not telemetry.get('last_error'):
        results['telemetry']='fresh, sending on current boot'
    if profile_value['id']=='qn90a':
        try:boot=json.loads(state['boot_status'])
        except (ValueError,TypeError):boot={}
        results['startup']='autonomous startup not established'
        if boot.get('boot')==state['boot'] and boot.get('accepted') is True and boot.get('outcome')=='foreground-confirmed' and 0<=boot.get('entered',1000)<=120:
            results['startup']='boot relay independently confirmed Hub on current boot'
    else:
        text=state['boot_status']
        results['startup']='native splash/Hub startup not established'
        if 'boot_id='+state['boot'] in text and 'ack=True' in text and 'resume=True' in text:
            results['startup']='native splash acknowledged Hub resume on current boot'
    if components is not None:
        results={k:v for k,v in results.items() if k in components}
    results['scope']='Read-only configuration/runtime checks; physical Home/AirPlay, saver visibility and playback require owner acceptance.'
    return results


def reboot_verify(profile_value,tv,evidence,seconds,nas=None):
    if not 30<=seconds<=300:raise Refused('--wait-seconds must be 30..300')
    before=tv.snapshot(privileged=True);record=dict(before_boot=before['boot'],phase='requesting',hub_launches=0)
    path=evidence/'reboot-verification.json';atomic_json(path,record)
    # Submitted once. No postboot launcher, service start, key or settings operation.
    tv.root("nohup /bin/sh -c 'sleep 15; busctl --timeout=5 --system call org.tizen.system.deviced /Org/Tizen/System/DeviceD/Power org.tizen.system.deviced.power Reboot s \"Owner-authorized tv-setup reboot verification\"' >/tmp/tv-setup-reboot.log 2>&1 </dev/null &\n")
    record['phase']='observing';atomic_json(path,record);deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        time.sleep(min(5,max(0,deadline-time.monotonic())))
        remaining=deadline-time.monotonic()
        if remaining<=0:break
        try:
            result=observe(profile_value,evidence,nas,remaining)
            if time.monotonic()>=deadline:break
            if result['boot']==before['boot']:continue
            latest=result['verification']
            record.update(after_boot=result['boot'],observations=latest)
            failed=any(any(term in value for term in ('not established','not observed','not verified','unavailable'))
                       for key,value in latest.items() if key!='scope')
            if not failed:
                record['phase']='verified';atomic_json(path,record);return latest
            atomic_json(path,record)
        except DeadlineExpired:
            record['connection']='observation timed out; diagnostic cleanup unconfirmed'
            break
        except KeyboardInterrupt:
            record['phase']='unverified';record['connection']='observation interrupted; diagnostic cleanup unconfirmed'
            atomic_json(path,record);raise
        except Exception:
            record['connection']='unavailable during reboot';atomic_json(path,record)
    record['phase']='unverified';atomic_json(path,record)
    raise Refused('Reboot startup not verified within deadline. No Hub launch was sent. Inspect '+str(path))


def activate(driver,doc,path):
    doc['activation']='requesting';atomic_json(path,doc)
    if doc.get('scope')=='ui' or driver.profile['id']=='qn90a' or not (set(selected(driver.choices)) & {'startup','splash','screensaver'}):
        driver.tv.sdk('set -eu\napp_launcher -k MiniHub001.Hub || true\napp_launcher -s MiniHub001.Hub\n')
    else:driver.tv.root('systemctl restart AT-HUB.service\n',namespace=True)
    if doc.get('scope')=='ui':
        if driver.tv.snapshot()['settings'].get('memory/appfw/current_fullscreen_appid')!='MiniHub001.Hub':
            raise Refused('Hub launch submitted but foreground not confirmed; inspect the TV before retrying')
    doc['activation']='submitted (explicit refresh, not autonomous startup)';atomic_json(path,doc)


def ui_scope(choices, actions=()):
    if selected(choices)!=['hub'] or choices.get('artifacts'):
        raise Refused('UI deployment requires only hub from current source')
    for action in actions:
        if action.component!='hub' or action.kind!='package' or action.options.get('package')!='MiniHub001':
            raise Refused('UI deployment cannot modify other components; use tv-setup for this run')


def launcher_scope(choices, actions=()):
    if set(selected(choices)) != set(LAUNCHER_COMPONENTS) or choices.get('artifacts') or choices.get('remove'):
        raise Refused('Launcher installation requires Hub/Home/AirPlay/startup from current source')
    for action in actions:
        if action.component not in LAUNCHER_COMPONENTS or action.kind in ('nas', 'uninstall', 'pairing', 'preferences'):
            raise Refused('Launcher installation cannot modify unrelated components; use tv-setup for this run')


def main(argv=None, *, ui_only=False, launcher_only=False):
    os.umask(0o077)
    args=parser().parse_args(argv)
    try:
        if ui_only and launcher_only:raise Refused('Conflicting setup scopes')
        site=load_site(args.site)
        p=configured_profile(args.device,site)
        target_binding=binding(site,args.device)
        if getattr(args,'non_interactive',False) and not args.yes:raise Refused('Noninteractive changes require --yes')
        if args.json and args.command in ('apply','rollback') and not args.yes:
            raise Refused('--json mutations require --yes; use plan --json to review first')
        if getattr(args,'config',None) is not None and not args.config.is_file():raise Refused('Config file does not exist')
        if args.command=='apply' and args.retry_unchanged and not args.resume:raise Refused('--retry-unchanged requires --resume')
        if getattr(args,'resume',None) and (cli_overrides(args) or args.config or args.activate):raise Refused('Resume uses saved run choices; rollback before changing choices or requesting separate activation')
        with contextlib.ExitStack() as stack:
            if args.command in ('apply','rollback') or (args.command=='verify' and args.reboot):
                stack.enter_context(lock(STATE/(args.device+'.lock')))
                # Shared lock also serializes NAS observations used for pairing/preflight.
                stack.enter_context(lock(STATE/'shared-nas.lock'))
            if args.command=='rollback' or getattr(args,'resume',None):
                identity=safe_id(args.run if args.command=='rollback' else args.resume)
                folder=STATE/'runs'/identity;doc=read_json(folder/'journal.json')
                if not doc or doc.get('device')!=args.device:raise Refused('Run does not belong to this device')
                if ui_only:
                    if doc.get('scope')!='ui':raise Refused('Not a UI deployment run; recover it with tv-setup')
                    ui_scope(doc['choices'],[Action(**row['action']) for row in doc['actions']])
                if launcher_only:
                    if doc.get('scope')!='launcher-web':raise Refused('Not a web launcher installation run; recover it with its original entry point')
                    launcher_scope(doc['choices'],[Action(**row['action']) for row in doc['actions']])
                if doc.get('target_binding')!=target_binding:raise Refused('Run destination/trust differs or predates site binding; recover using its original checkout and configuration')
                choices=resolve(args.device,doc['choices'])
                local_only=(args.command=='apply' and doc.get('phase') in ('configuration-applied','finalizing')) or (args.command=='rollback' and all(row['phase'] in ('planned','prepared','backing-up','backed-up','rolled-back') for row in doc.get('actions',[])))
                tv=None if local_only else Transport(p,folder/'evidence');nas=NAS(folder,site.get('nas'))
                driver=None if local_only else Driver(tv,p,choices,folder,nas);engine=Engine(driver,folder,args.device,choices,nas,target_binding=target_binding,state_dir=STATE);engine.load()
                print(('Rollback' if args.command=='rollback' else 'Reconcile/resume')+' run '+identity+' for '+args.device+'.',file=sys.stderr if args.json else sys.stdout)
                if any(row['action']['kind']=='nas' for row in doc['actions']):
                    print('Includes shared NAS files for BOTH TVs.',file=sys.stderr if args.json else sys.stdout)
                    if args.command=='apply' and not args.shared_nas:raise Refused('Resuming shared changes requires --shared-nas')
                accept(args)
                if args.command=='rollback':
                    manual=engine.rollback()
                    if args.json:print(json.dumps(dict(run=identity,phase=engine.doc['phase'],manual_recovery=manual)))
                    else:print('Reversible configuration rollback complete.'+(' Manual app recovery required: '+', '.join(manual) if manual else ''))
                    return 3 if manual else 0
                engine.reconcile(args.retry_unchanged);engine.apply();engine.finalize()
                print(json.dumps(dict(run=identity,phase=engine.doc['phase'])) if args.json else 'Completed run '+identity+'.');return 0
            unfinished=pending(STATE,args.device)
            if args.command=='apply' and unfinished:
                raise Refused('Unfinished run '+unfinished[0][0]+': use apply --resume or rollback --run before a new apply')
            if launcher_only:
                choices=resolve(args.device,overrides={'components':list(LAUNCHER_COMPONENTS),'exclude':[],'keep':[],'remove':[],'artifacts':{}})
            elif ui_only:
                choices=resolve(args.device,overrides={'components':['hub'],'exclude':[],'keep':[],'remove':[],'artifacts':{}})
            else:
                choices=resolve(args.device,read_json(STATE/(args.device+'-choices.json')),
                                read_json(args.config) if args.config else None,cli_overrides(args))
            identifier=run_id();folder=STATE/'runs'/identifier if args.command=='apply' else STATE/'inspections'/identifier
            tv=Transport(p,folder/'evidence');nas=NAS(folder,site.get('nas'))
            state=tv.snapshot(privileged=args.privileged_inspection or args.command=='apply')
            atomic_json(folder/'snapshot.json',state)
            if ui_only and not any(row[0]=='MiniHub001' for row in state['packages']):
                raise Refused('Hub is not installed; use tv-setup for initial installation')
            proposal=plan(p,choices,state,read_json(STATE/(args.device+'-ledger.json')))
            if 'telemetry' in selected(choices):
                try:nas.check_pairing(proposal,p,state)
                except Exception as e:
                    atomic_json(folder/'telemetry-error.json',dict(type=type(e).__name__,detail=str(e)))
                    proposal.unsupported('telemetry',str(e) if isinstance(e,Refused) else 'NAS inspection failed; inspect private evidence and connection settings')
            if 'dashboard' in selected(choices):
                try:nas.add_plan(proposal,args.shared_nas)
                except Exception as e:
                    atomic_json(folder/'dashboard-error.json',dict(type=type(e).__name__,detail=str(e)))
                    proposal.unsupported('dashboard',str(e) if isinstance(e,Refused) else 'NAS inspection failed; inspect private evidence and connection settings')
            order_actions(proposal)
            if ui_only:ui_scope(choices,proposal.actions)
            if launcher_only:launcher_scope(choices,proposal.actions)
            unfinished=pending(STATE,args.device)
            for run,doc in unfinished:
                proposal.issues.append('Unfinished run '+run+': use apply --resume '+run+' or rollback --run '+run)
                for row in doc['actions']:
                    if row['phase'] in ('applying','uncertain','rolling-back','manual-recovery'):
                        proposal.states[row['action']['component']]='partially applied'
            if args.command=='verify':
                if args.reboot:
                    if unfinished:raise Refused('Reconcile partial runs before reboot verification')
                    result=reboot_verify(p,tv,folder,args.wait_seconds,nas)
                else:
                    result=verification(p,state,selected(choices))
                    if set(selected(choices)) & {'telemetry','dashboard'}:
                        try:result.update(nas.verify(args.device,state['boot'],(state.get('preferences') or {}).get('enabled',True)))
                        except Exception:result['receiver']='receiver/dashboard verification unavailable'
                summary(proposal,args.json,dict(verification=result))
                failed=any(any(term in value for term in ('not established','not observed','not verified','unavailable')) for key,value in result.items() if key!='scope')
                return 2 if proposal.actions or proposal.issues or failed else 0
            if args.command!='apply':
                summary(proposal,args.json);return 2 if proposal.issues else 0
            if proposal.issues:
                summary(proposal,args.json);raise Refused('Preflight blocked; no setup mutations were submitted')
            driver=Driver(tv,p,choices,folder,nas);engine=Engine(driver,folder,args.device,choices,nas,target_binding=target_binding,state_dir=STATE,scope='ui' if ui_only else 'launcher-web' if launcher_only else 'setup')
            engine.prepare(proposal,state)
            proposal.actions=[Action(**row['action']) for row in engine.doc['actions']]
            extra={'run':identifier}
            recovery=[row['action']['options'].get('package') for row in engine.doc['actions'] if row['info'].get('recovery')]
            if recovery:extra['package_recovery']='No matching signed previous package for '+', '.join(recovery)+'; installed-file archives alone cannot reinstall it.'
            if args.activate:extra['activation']='Close/reopen Hub and check foreground; no reboot.' if ui_only else 'Explicitly refresh Hub/AT-HUB after configuration; this is not a reboot.'
            summary(proposal,args.json,extra)
            try:
                if proposal.actions or args.activate:accept(args)
            except BaseException:
                engine.doc['phase']='cancelled';engine.save();raise
            engine.apply();engine.finalize()
            if args.activate:
                try:activate(driver,engine.doc,engine.path)
                except BaseException:
                    # UI installation is already committed and verified. A lost
                    # foreground acknowledgement must not strand package recovery.
                    engine.doc['activation']='uncertain; inspect the TV before requesting another launch'
                    if not ui_only:engine.doc['phase']='activation-uncertain'
                    engine.save();raise
            saved='Setup choices preserved.' if ui_only or launcher_only else 'Choices saved.'
            refresh='Explicit activation submitted.' if args.activate else (
                'Hub refreshes on its next normal start; use deploy-ui apply --launch to open it now.' if ui_only else
                'Running apps refresh on their next normal start; use --activate when applying to refresh now.')
            print('Completed run '+identifier+'. '+saved+' '+refresh,file=sys.stderr if args.json else sys.stdout)
            return 0
    except (Exception,KeyboardInterrupt) as error:
        # External tool logs and secrets stay in the private evidence/journal.
        if 'folder' in locals():
            with contextlib.suppress(Exception):
                atomic_json(folder/'error.json',dict(type=type(error).__name__,detail=str(error)))
        if 'folder' in locals() and (folder/'journal.json').exists():print('Private run: '+str(folder),file=sys.stderr)
        print('tv-setup: '+('Interrupted; reconcile the pending run before retrying' if isinstance(error,KeyboardInterrupt) else 'Local storage is full; free space and resume the pending run before retrying changes' if isinstance(error,OSError) and error.errno==errno.ENOSPC else str(error) if isinstance(error,Refused) else 'Local dependency, configuration or transport failure; inspect the private error log and installation guide'),file=sys.stderr)
        return 1


def cli_overrides(args):
    result={}
    for k in ('components','exclude','keep','remove'):
        v=getattr(args,k,None)
        if v is not None:result[k]=[x.strip() for x in v.split(',') if x.strip()]
    if args.telemetry_enabled is not None:result['telemetry_enabled']={'true':True,'false':False,'preserve':None}[args.telemetry_enabled]
    if args.endpoint is not None:result['endpoint']=args.endpoint
    if args.artifact:
        result['artifacts']={}
        for item in args.artifact:
            if '=' not in item:raise Refused('--artifact requires NAME=PATH')
            key,value=item.split('=',1);result['artifacts'][key]=value
    return result
