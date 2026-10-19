"""Execute the production collector's parser and SQLite reader on the host."""
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import hashlib
from telemetry_service_test import project

ROOT=Path(__file__).resolve().parents[1]

def main():
    with tempfile.TemporaryDirectory(prefix='tv-inspector-') as tmp:
        root=Path(tmp);db=root/'registry.db'
        with sqlite3.connect(db) as c:
            c.executescript('''CREATE TABLE package_info(package TEXT PRIMARY KEY,package_version TEXT,package_type TEXT,package_system TEXT,package_removable TEXT,package_disable TEXT);
            CREATE TABLE package_app_info(app_id TEXT PRIMARY KEY,package TEXT,app_component TEXT,app_disable TEXT,app_onboot TEXT,app_autorestart TEXT);
            CREATE TABLE package_localized_info(package TEXT,package_locale TEXT,package_label TEXT);
            INSERT INTO package_info VALUES('test','1','tpk','true','false','false');
            INSERT INTO package_localized_info VALUES('test','en_US','Test');''')
            c.executemany('INSERT INTO package_app_info VALUES(?,?,?,?,?,?)',[(f'app{i:04}', 'test','svcapp','unknown','true','false') for i in range(1026)])
        before=hashlib.sha256(db.read_bytes()).digest()
        project(root/'Harness.csproj',[ROOT/'tests/inspector-collector-harness.cs',ROOT/'research/s90d-telemetry/collector/Inspector.cs'],'<OutputType>Exe</OutputType>')
        subprocess.run(['dotnet','run','--project',str(root/'Harness.csproj'),'--',str(db)],check=True,timeout=90)
        assert hashlib.sha256(db.read_bytes()).digest()==before
        project(root/'Scope.csproj',[ROOT/'tests/telemetry-scope-harness.cs',ROOT/'research/s90d-telemetry/collector/Program.cs'],
                '<OutputType>Exe</OutputType><StartupObject>ScopeHarness</StartupObject>')
        subprocess.run(['dotnet','run','--project',str(root/'Scope.csproj')],check=True,timeout=90)

if __name__=='__main__':main()
