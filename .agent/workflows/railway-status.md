---
description: Fetch Railway backend data (stats, crawler logs, health)
---

# Railway Status Workflow

This workflow has been upgraded to a full Skill.
Please refer to the **Railway Ops & Debugging** skill located at `.agent/skills/railway_ops/SKILL.md`.

You can now use the skill to:
1. Check Railway Status (Health, Stats, Logs)
2. Follow the Build Debugging Protocol
3. **Deploy with Git Version Logging** (NEW)

## Quick Deploy Command
```bash
echo "=== Deploying Git Version ===" && git log -1 --oneline && railway up
```

To use full documentation:
`view_file .agent/skills/railway_ops/SKILL.md`
