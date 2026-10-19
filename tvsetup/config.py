"""Choice precedence: recommendations < saved choices < file < CLI."""
import copy
import json
from urllib.parse import urlsplit
from .common import REPO, Refused, read_json

LAUNCHER_COMPONENTS = ('hub', 'home', 'airplay', 'startup')

COMPONENTS = ('hub', 'screensaver', 'splash', 'home', 'airplay', 'startup', 'telemetry', 'dashboard', 'cleanup')
DEFAULTS = dict(components=list(COMPONENTS), exclude=[], keep=[], remove=[],
                telemetry_enabled=None, endpoint=None, artifacts={})


def profile(device):
    return read_json(REPO / 'tvsetup/profiles' / (device + '.json'))


def resolve(device, saved=None, file=None, overrides=None):
    result = copy.deepcopy(DEFAULTS)
    result['remove'] = list(profile(device)['cleanup'])
    for layer in (saved, file, overrides):
        if layer is None:continue
        if not isinstance(layer,dict):raise Refused('Each configuration layer must be a JSON object')
        for key in ('components','exclude','keep','remove'):
            if key in layer and (not isinstance(layer[key],list) or any(not isinstance(v,str) for v in layer[key])):
                raise Refused(key+' must be a list of strings')
        if not layer:continue
        unknown = set(layer) - set(DEFAULTS)
        if unknown: raise Refused('Unknown settings (identity/safety guards cannot be overridden): ' + ', '.join(sorted(unknown)))
        if set(layer.get('keep',[])) & set(layer.get('remove',[])): raise Refused('A package cannot be both kept and removed in one layer')
        if 'keep' in layer: result['remove'] = [x for x in result['remove'] if x not in layer['keep']]
        if 'remove' in layer: result['keep'] = [x for x in result['keep'] if x not in layer['remove']]
        if 'artifacts' in layer and isinstance(layer['artifacts'],dict):
            layer={**layer,'artifacts':{**result['artifacts'],**layer['artifacts']}}
        result.update(copy.deepcopy(layer))
    for key in ('components', 'exclude', 'keep', 'remove'):
        if not isinstance(result[key], list) or any(not isinstance(x, str) for x in result[key]):
            raise Refused(key + ' must be a list of strings')
    if (set(result['components']) | set(result['exclude'])) - set(COMPONENTS):
        raise Refused('Unknown component')
    allowed = set(profile(device)['cleanup'])
    if (set(result['keep']) | set(result['remove'])) - allowed:
        raise Refused('Cleanup overrides must name reviewed package IDs; protection flags never grant eligibility')
    if set(result['keep']) & set(result['remove']): raise Refused('A package cannot be both kept and removed')
    if result['telemetry_enabled'] is not None and type(result['telemetry_enabled']) is not bool:
        raise Refused('telemetry_enabled must be true, false, or null (preserve)')
    if result['endpoint'] is not None: validate_endpoint(device, result['endpoint'])
    if not isinstance(result['artifacts'], dict) or set(result['artifacts']) - {'hub', 'saver', 'boot', 'service', 'renderer'}:
        raise Refused('artifacts accepts hub, saver, boot, service, renderer paths')
    if any(not isinstance(v, str) for v in result['artifacts'].values()): raise Refused('Artifact paths must be strings')
    return result


def validate_endpoint(device, value):
    if not isinstance(value, str) or len(value) > 512: raise Refused('Invalid endpoint')
    try:
        url = urlsplit(value)
        valid = (url.scheme == 'https' and url.hostname and not url.username and not url.password
                 and not url.query and not url.fragment and url.port != 0
                 and url.path in ('/v1/devices/' + device, *(['/v1/s90d'] if device == 's90d' else [])))
    except ValueError: valid = False
    if not valid: raise Refused('Endpoint must be credential-free HTTPS with this TV’s device path')
    return value


def selected(choices):
    return [c for c in COMPONENTS if c in choices['components'] and c not in choices['exclude']]
