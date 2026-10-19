"""Scheduling and failure-boundary tests; fake time, no device access."""
import importlib.util
from pathlib import Path
import sys
import unittest

SOURCE=Path(__file__).resolve().parents[1]/'research/autonomous-root/native-worker/observer-series-controller.py'
spec=importlib.util.spec_from_file_location('observer_controller',SOURCE)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)


class Fake:
    def __init__(self):
        self.now=0;self.events=[];self.timers={};self.collectors={};self.fail=None;self.delay={}
    def clock(self):return self.now
    def sleep(self,seconds):self.now+=seconds
    def event(self,name):
        self.events.append((self.now,name))
        self.now+=self.delay.get(name,0)
        if self.fail==name:raise RuntimeError('uncertain '+name)
    def health(self):self.event('health')
    def arm_rescue(self,seconds):
        self.event('arm');key=len(self.timers);self.timers[key]=self.now+seconds;return key
    def retire_rescue(self,key):
        self.event('retire');assert self.timers[key]>self.now
        assert any(k!=key and end>self.now for k,end in self.timers.items())
        self.timers[key]=0
    def launch(self,index,seconds):
        self.event('launch');assert len(self.collectors)<2
        self.collectors[index]=self.now+seconds;return index
    def collect(self,key):
        self.event('collect');assert self.now>=self.collectors[key]
        del self.collectors[key];return key
    def run(self,plan=None):return m.run(self,plan or m.Plan(180,80,50,45,10),self.clock,self.sleep)


class ControllerTests(unittest.TestCase):
    def test_rolls_bounded_windows_and_leaves_last_rescue_armed(self):
        f=Fake();r=f.run();self.assertEqual(r['captures'],[0,1,2]);self.assertFalse(f.collectors)
        self.assertEqual(sum(end>f.now for end in f.timers.values()),1)
        self.assertGreater(f.timers[r['rescue']],f.now)
        self.assertGreaterEqual(sum(name=='retire' for _,name in f.events),3)
    def test_uncertain_arm_never_retires_original(self):
        f=Fake()
        original=f.arm_rescue
        def arm(seconds):
            if f.timers:f.fail='arm'
            return original(seconds)
        f.arm_rescue=arm
        with self.assertRaisesRegex(RuntimeError,'uncertain arm'):f.run()
        self.assertNotIn('retire',[name for _,name in f.events]);self.assertEqual(len(f.timers),1)
    def test_uncertain_retirement_stops_without_launch_replay(self):
        f=Fake();f.fail='retire'
        with self.assertRaisesRegex(RuntimeError,'uncertain retire'):f.run()
        self.assertEqual(sum(name=='launch' for _,name in f.events),1)
        self.assertEqual(sum(end>f.now for end in f.timers.values()),2)
    def test_collect_failure_keeps_evidence_and_rescue(self):
        f=Fake();f.fail='collect'
        with self.assertRaisesRegex(RuntimeError,'uncertain collect'):f.run()
        self.assertEqual(len(f.collectors),2);self.assertTrue(any(end>f.now for end in f.timers.values()))
    def test_health_failure_does_not_start_or_renew(self):
        f=Fake();f.fail='health'
        with self.assertRaisesRegex(RuntimeError,'uncertain health'):f.run()
        self.assertFalse(f.timers);self.assertFalse(f.collectors)
    def test_selection_drift_during_run_preserves_rescue_without_more_work(self):
        f=Fake();original=f.health
        def health():
            if f.now>=20:f.fail='health'
            original()
        f.health=health
        with self.assertRaisesRegex(RuntimeError,'uncertain health'):f.run()
        self.assertEqual(sum(name=='launch' for _,name in f.events),1)
        self.assertNotIn('retire',[name for _,name in f.events])
        self.assertTrue(any(end>f.now for end in f.timers.values()))
    def test_slow_collect_cannot_silently_lose_overlap(self):
        f=Fake();f.delay['collect']=60
        with self.assertRaisesRegex(m.ObservationStopped,'overlap lost'):f.run()
        self.assertEqual(sum(name=='launch' for _,name in f.events),2)
    def test_expired_recovery_margin_stops_after_slow_call(self):
        f=Fake();f.delay['launch']=271
        with self.assertRaisesRegex(m.ObservationStopped,'renewal margin'):f.run()
        self.assertEqual(sum(name=='launch' for _,name in f.events),1)
    def test_plan_refuses_unbounded_and_unsafe_intervals(self):
        for p in [m.Plan(True),m.Plan(90001),m.Plan(180,80,40),m.Plan(180,80,70),m.Plan(180,80,50,250)]:
            with self.assertRaises(ValueError):p.validate()
        self.assertLessEqual(m.Plan(90000).validate(),1024)

    def test_full_day_plan_has_margin_for_job_start_and_terminal_observation(self):
        plan=m.Plan(86460)
        self.assertEqual(plan.validate(),540)
        self.assertGreaterEqual((plan.validate()-1)*plan.stride_seconds+plan.window_seconds,86460)
        f=Fake();result=f.run(plan)
        self.assertEqual(len(result['captures']),540)
        self.assertFalse(f.collectors)
        self.assertEqual(sum(end>f.now for end in f.timers.values()),1)

    def test_storage_checks_initial_allowance_and_ongoing_floor(self):
        plan=m.Plan(86460)
        required=m.require_storage(100*1024**3,plan,concurrent_runs=2,initial=True)
        self.assertGreater(required,12*1024**3)
        self.assertEqual(m.require_storage(required,plan,2,True),required)
        with self.assertRaises(m.ObservationStopped):m.require_storage(required-1,plan,2,True)
        self.assertEqual(m.require_storage(2*1024**3,plan),2*1024**3)
        with self.assertRaises(m.ObservationStopped):m.require_storage(2*1024**3-1,plan)

    def test_storage_refuses_unknown_or_invalid_capacity(self):
        for free,runs in [(None,1),(True,1),(-1,1),(2**40,0),(2**40,3)]:
            with self.assertRaises(ValueError):m.require_storage(free,m.Plan(180),runs,True)

    def test_device_space_uses_the_smaller_of_both_filesystems(self):
        output='Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/a 1000000 100000 800000 10% /opt\n/dev/b 1000000 100000 262144 10% /opt/usr\n'
        self.assertEqual(m.require_device_storage(output),256*1024**2)
        with self.assertRaisesRegex(m.ObservationStopped,'floor exhausted'):
            m.require_device_storage(output.replace('262144','262143'))

    def test_device_space_refuses_partial_or_malformed_snapshots(self):
        header='Filesystem 1024-blocks Used Available Capacity Mounted on\n'
        row='/dev/a 1000000 100000 800000 10% /opt\n'
        for output in (None,header+row,header+row*3,header+row+row.replace('800000','-1'),
                       header+row+row.replace('800000','1000001'),
                       header+row+row.replace('800000','999999'),
                       header+row+row.replace('800000','NaN')):
            with self.assertRaises(m.ObservationStopped):m.require_device_storage(output)

    def test_in_band_device_space_failure_stops_without_new_work(self):
        f=Fake();original=f.health
        def health():
            original()
            free=300000 if f.now<20 else 100000
            m.require_device_storage('Filesystem 1024-blocks Used Available Capacity Mounted on\n'+
                                     (f'/dev/a 1000000 100000 {free} 10% /opt\n')*2)
        f.health=health
        with self.assertRaisesRegex(m.ObservationStopped,'floor exhausted'):f.run()
        self.assertEqual(sum(name=='launch' for _,name in f.events),1)
        self.assertNotIn('retire',[name for _,name in f.events])
        self.assertTrue(any(end>f.now for end in f.timers.values()))

    def collector_state(self, substate='running', **changes):
        return dict(dict(LoadState='loaded', RemainAfterExit='yes', ActiveState='active',
                         SubState=substate, Result='success', ExecMainStatus='0',
                         ExecMainStartTimestampMonotonic='123456'), **changes)

    def test_collector_active_zero_status_is_not_completion(self):
        f=Fake();observations=[]
        def inspect():
            observations.append(f.now)
            return self.collector_state('running' if f.now<1 else 'exited')
        result=m.wait_for_collector_exit(inspect,clock=f.clock,sleep=f.sleep)
        self.assertEqual(result['SubState'],'exited')
        self.assertEqual(f.now,1)
        self.assertEqual(len(observations),5)

    def test_collector_exit_wait_requires_retained_execution_evidence(self):
        f=Fake();states=iter([self.collector_state(ActiveState='activating'),
                             self.collector_state(),self.collector_state('exited')])
        result=m.wait_for_collector_exit(lambda:next(states),clock=f.clock,sleep=f.sleep)
        self.assertEqual(result['SubState'],'exited')
        for changes in (dict(LoadState='not-found'), dict(RemainAfterExit='no'),
                        dict(ActiveState='failed'),dict(ActiveState='inactive'),
                        dict(Result='signal'),dict(ExecMainStatus='1'),dict(ExecMainStatus=None),
                        dict(ExecMainStartTimestampMonotonic='0'),dict(ExecMainStartTimestampMonotonic=None),
                        dict(ExecMainStartTimestampMonotonic=str(2**64))):
            with self.assertRaises(m.ObservationStopped):
                m.wait_for_collector_exit(lambda:self.collector_state('exited',**changes),clock=f.clock,sleep=f.sleep)

    def test_collector_exit_timeout_leaves_the_unit_and_rescue_untouched(self):
        f=Fake();calls=[]
        def inspect():
            calls.append(f.now)
            return self.collector_state()
        with self.assertRaisesRegex(m.ObservationStopped,'timed out'):
            m.wait_for_collector_exit(inspect,1,clock=f.clock,sleep=f.sleep)
        self.assertEqual(f.now,1)
        self.assertEqual(calls,[0,.25,.5,.75])
        self.assertFalse(f.events)

    def test_collector_inspection_error_is_not_silently_retried(self):
        calls=[]
        def inspect():
            calls.append(True)
            raise OSError('inspection response unavailable')
        with self.assertRaisesRegex(OSError,'response unavailable'):
            m.wait_for_collector_exit(inspect)
        self.assertEqual(calls,[True])

    def test_slow_exit_inspection_cannot_pass_after_its_budget(self):
        f=Fake()
        def inspect():
            f.now+=2
            return self.collector_state('exited')
        with self.assertRaisesRegex(m.ObservationStopped,'timed out'):
            m.wait_for_collector_exit(inspect,1,clock=f.clock,sleep=f.sleep)

    def test_collector_exit_wait_refuses_unbounded_or_invalid_budgets(self):
        for seconds in (True,0,-1,31,float('nan'),float('inf'),None):
            with self.assertRaises(ValueError):m.wait_for_collector_exit(lambda:None,seconds)


if __name__=='__main__':unittest.main()
