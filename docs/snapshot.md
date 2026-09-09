# Manual snapshot workflow

The original `.pi/agent/extensions/compute` is the working source. This checkout is a reviewed export, not a second synchronized source. No sync hook, symlink, or background job is installed.

For a later snapshot:

1. Work and test in the original repository. Record `git rev-parse HEAD` and `git status --short`; document local tracked changes if any.
2. Inspect the destination first. Do not copy over an existing checkout blindly. Create a fresh staging directory and refuse an existing staging path.
3. Get the exact allowlist with `git ls-files -z -- extensions/compute`. Copy each listed file’s current contents, removing only that directory prefix. Do not copy the full agent directory or use a recursive directory copy that includes untracked files.
4. Compare the staging export with this repository. Review additions, changes, and removals explicitly. Preserve the standalone metadata and test portability adjustments where still needed. Do not copy personal settings, credentials, other extensions, or prompt customization.
5. Review any packaging-only differences. Reinspect dependency imports, update the lockfile deliberately, run `npm ci` and all tests, and record failures honestly.
6. Review the diff and commit locally using the existing Git identity. Repository creation and pushing are separate, explicitly authorized operations.

Do not copy snapshot edits back into the working source automatically. Make intended source changes there deliberately, then take another reviewed snapshot.
