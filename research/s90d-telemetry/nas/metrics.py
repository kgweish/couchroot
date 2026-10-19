"""Parse a bounded TV snapshot; calculate rates only across one uninterrupted boot."""
import math
import re
import uuid

FIELDS = ('stat', 'meminfo', 'netdev', 'diskstats')

def validate(data):
    if not isinstance(data, dict) or data.get('schema') != 1:
        raise ValueError('schema')
    if not isinstance(data.get('boot'),str):raise ValueError('boot')
    uuid.UUID(data['boot'])
    if 'session' in data:
        if not isinstance(data['session'],str):raise ValueError('session')
        uuid.UUID(data['session'])
    if 'device' in data and not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}', data['device']): raise ValueError('device')
    if type(data['seq']) is not int or data['seq'] < 1:
        raise ValueError('sequence')
    for name in ('uptime', 'collector_cpu_seconds', 'collector_rss_bytes'):
        value = data[name]
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError(name)
    for name in FIELDS:
        if data[name] is not None and (not isinstance(data[name], str) or len(data[name]) > 16384):
            raise ValueError(name)
    parse(data)
    result = {key: data[key] for key in ('schema', 'boot', 'seq', 'uptime', 'collector_cpu_seconds', 'collector_rss_bytes') + FIELDS + tuple(k for k in ('session','device') if k in data)}
    if data.get('device') != 'qn90a' and 'inspector' in data:
        from inspector import validate as validate_inspector
        result['inspector'] = validate_inspector(data['inspector'], data['uptime'])
    return result

def parse(data):
    lines = (data['stat'] or '').splitlines()
    cpu = None if data['stat'] is None else [int(v) for v in next(line for line in lines if line.startswith('cpu ')).split()[1:9]]
    if cpu is not None and (len(cpu) != 8 or any(v < 0 for v in cpu)):
        raise ValueError('cpu')
    mem = {parts[0].rstrip(':'): int(parts[1]) for line in (data['meminfo'] or '').splitlines() if len(parts := line.split()) >= 2}
    if data['meminfo'] is not None and (mem.get('MemTotal', 0) <= 0 or not 0 <= mem.get('MemAvailable', -1) <= mem['MemTotal']):
        raise ValueError('memory')
    net = None
    for line in (data['netdev'] or '').splitlines():
        if ':' not in line:
            continue
        name, counters = line.split(':', 1)
        values = counters.split()
        if name.strip() != 'lo' and len(values) >= 16:
            if min(int(v) for v in values) < 0: raise ValueError('network')
            if net is None: net = [0, 0]
            net[0] += int(values[0]); net[1] += int(values[8])
    disk = None
    for line in (data['diskstats'] or '').splitlines():
        values = line.split()
        # Whole physical eMMC only; never sum it together with its partitions.
        if len(values) >= 14 and re.fullmatch(r'mmcblk[0-9]+', values[2]):
            if min(int(v) for v in values[3:]) < 0: raise ValueError('disk')
            if disk is None: disk = [0, 0]
            disk[0] += int(values[5]) * 512; disk[1] += int(values[9]) * 512
    return cpu, mem, net, disk

def calculate(current, previous):
    cpu, mem, net, disk = parse(current)
    result = {
        'collector_memory': {'rss': current['collector_rss_bytes']/1048576},
        'uptime': {'uptime': current['uptime']},
    }
    if mem: result['memory'] = {'used': (mem['MemTotal']-mem['MemAvailable'])/1024, 'available': mem['MemAvailable']/1024}
    if previous is None or previous['boot'] != current['boot'] or current.get('session') != previous.get('session') or current.get('device') != previous.get('device') or current['seq'] <= previous['seq']:
        return result
    elapsed = current['uptime']-previous['uptime']
    if elapsed <= 0 or elapsed > 45:
        return result
    old_cpu, _, old_net, old_disk = parse(previous)
    delta = [a-b for a,b in zip(cpu, old_cpu)] if cpu is not None and old_cpu is not None else []
    total = sum(delta)
    if delta and min(delta) >= 0 and total > 0:
        result['cpu'] = dict(zip(('user','nice','system','idle','iowait','irq','softirq','steal'), (v*100/total for v in delta)))
    def counters(sample,field):
        lines=(sample[field] or '').splitlines()
        if field=='netdev':
            return {line.split(':',1)[0].strip(): (int(line.split(':',1)[1].split()[0]),int(line.split(':',1)[1].split()[8]))
                    for line in lines if ':' in line and line.split(':',1)[0].strip()!='lo' and len(line.split(':',1)[1].split())>=16}
        return {line.split()[2]:(int(line.split()[5]),int(line.split()[9])) for line in lines
                if len(line.split())>=14 and re.fullmatch(r'mmcblk[0-9]+',line.split()[2])}
    for name, new, old in (('network',net,old_net),('disk',disk,old_disk)):
        field='netdev' if name=='network' else 'diskstats'
        newer=counters(current,field);older=counters(previous,field)
        if newer.keys()!=older.keys() or any(a<b for key in newer for a,b in zip(newer[key],older[key])): continue
        if new is not None and old is not None and all(a>=b for a,b in zip(new,old)):
            result[name] = dict(zip(('read','write'),((a-b)/elapsed/1024 for a,b in zip(new,old))))
    consumed = current['collector_cpu_seconds']-previous['collector_cpu_seconds']
    if consumed >= 0:
        result['collector_cpu'] = {'cpu': consumed/elapsed*100}
    return result
