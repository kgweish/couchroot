// Test-only deterministic short-job exit boundary. SPDX-License-Identifier: 0BSD
using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
internal static partial class SamsungTvRootAgent
{
    internal static int TestStartedProcessIdentity()
    {
        if (Environment.GetEnvironmentVariable("COUCHROOT_PARITY_CONTAINER") != "1")
            throw new InvalidOperationException("Use an isolated disposable container");
        using (var live = Process.Start(new ProcessStartInfo("/bin/sleep", "30") { UseShellExecute = false })) {
            try { Check(!string.IsNullOrEmpty(StartedProcessIdentity(live)), "live process identity missing"); }
            finally { live.Kill(); live.WaitForExit(); }
            Check(StartedProcessIdentity(live) == null, "exited process should have no start identity");
        }
        string root = Path.GetTempPath() + "job-identity-" + Guid.NewGuid().ToString("N") + "/";
        Directory.CreateDirectory(root);
        try {
            for (int i = 0; i < 64; i++) {
                string id = Guid.NewGuid().ToString("N");
                Call(new {op="job.start", id, command="printf kept; exit 7", profile="root", timeout_ms=5000}, root);
                Check(SpinWait.SpinUntil(() => { lock (Jobs[id]) return Jobs[id].Finished; }, 5000), "short job monitor did not finish");
                var status = Call(new {op="job.status", id}, root);
                Check(status.GetProperty("state").GetString()=="completed" && status.GetProperty("exit_code").GetInt32()==7, "short job outcome lost");
                using (var saved = JsonDocument.Parse(File.ReadAllText(JobRoot+"/"+id+".json")))
                    Check(saved.RootElement.GetProperty("exit_code").GetInt32()==7, "retained outcome lost");
                var output = Call(new {op="job.output", id, stdout_cursor=0, stderr_cursor=0}, root);
                Check(output.GetProperty("stdout").GetProperty("data").GetString()=="a2VwdA==", "short job output lost");
                Call(new {op="job.forget", id}, root);
            }
        } finally { StopJobs(); Directory.Delete(root, true); }
        Console.WriteLine("JOB_IDENTITY_OK 64 short jobs");
        return 0;
    }
}
