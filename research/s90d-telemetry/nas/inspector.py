"""Allowlisted inventory snapshots. No control operations or command transport."""
import math

APP_TEXT = ('id', 'package', 'version', 'type', 'component', 'label')
APP_FLAGS = ('system', 'removable', 'package_disabled', 'app_disabled', 'on_boot', 'auto_restart')


def numeric(value, maximum=1e15):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
        raise ValueError('inspector number')
    return value


def text(value, nullable=False, maximum=512):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or len(value.encode('utf-8')) > maximum:
        raise ValueError('inspector text')
    return value


def validate(value, uptime):
    if not isinstance(value, dict) or value.get('schema') != 1:
        raise ValueError('inspector schema')
    observed = numeric(value['uptime'])
    if observed > uptime or uptime - observed > 150:
        raise ValueError('inspector time')
    result = {'schema': 1, 'uptime': observed}
    for name, limit in (('apps', 1024), ('processes', 512)):
        section = value[name]
        if not isinstance(section, dict) or section.get('status') not in ('ok', 'partial', 'unavailable'):
            raise ValueError('inspector status')
        rows = section['rows']
        if not isinstance(rows, list) or len(rows) > limit or (section['status'] == 'unavailable' and rows):
            raise ValueError('inspector rows')
        if type(section['truncated']) is not bool or type(section['skipped']) is not int:
            raise ValueError('inspector coverage')
        skipped = numeric(section['skipped'], 100000)
        if section['status'] == 'ok' and (section['truncated'] or skipped):
            raise ValueError('inspector incomplete')
        clean, identities = [], set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('inspector row')
            if name == 'apps':
                item = {key: text(row[key], nullable=key not in ('id', 'package')) for key in APP_TEXT}
                if not item['id'] or not item['package']:
                    raise ValueError('inspector identity')
                for key in APP_FLAGS:
                    if row[key] is not None and type(row[key]) is not bool:
                        raise ValueError('inspector flag')
                    item[key] = row[key]
                identity = item['id']
            else:
                if type(row['pid']) is not int or not 0 < row['pid'] <= 4194304:
                    raise ValueError('inspector pid')
                item = {'pid': row['pid'], 'name': text(row['name'], maximum=128),
                        'state': text(row['state'], maximum=1), 'rss_bytes': None if row['rss_bytes'] is None else numeric(row['rss_bytes']),
                        'cpu_percent': None if row['cpu_percent'] is None else numeric(row['cpu_percent'], 100000)}
                identity = item['pid']
            if identity in identities:
                raise ValueError('inspector duplicate')
            identities.add(identity)
            clean.append(item)
        result[name] = {'status': section['status'], 'rows': clean,
                        'truncated': section['truncated'], 'skipped': skipped}
        if name == 'processes':
            scope=section.get('scope','visible-proc')
            if scope not in ('managed-apps','visible-proc'):raise ValueError('inspector scope')
            result[name]['scope']=scope
    return result


def carry(current, previous):
    """Preserve minute snapshots only within the same device, boot and collector."""
    if current.get('device') == 'qn90a':
        current.pop('inspector', None)  # Drop legacy senders and never carry old inventory.
        return
    if 'inspector' in current or not previous:
        return
    if all(current.get(k) == previous.get(k) for k in ('device', 'boot', 'session')) and current.get('session'):
        if 'inspector' in previous:
            current['inspector'] = previous['inspector']
