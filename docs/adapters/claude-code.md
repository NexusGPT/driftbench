# Claude Code estates

Status: in progress (scan, map, plan and replay first). This page maps a Claude Code estate onto the generic estate shapes of [testing an estate](../estate.md).

| Generic atom kind | Claude Code source |
|---|---|
| Instruction, gate | `CLAUDE.md`, memory files, the bodies of `SKILL.md` files and agent files |
| Route | the `description` of each skill and agent, routing tables in `CLAUDE.md` |
| Skill, reference, script | a skill folder: `SKILL.md` (frontmatter and body), the files it names, its scripts, the hooks in its frontmatter |
| Subagent | `.claude/agents/*.md`: name, description, tools, model, effort, skills, the body |
| Guard | hooks in `settings.json` (event, matcher, command) and in skill frontmatter, the hook source, a check registry when the estate keeps one |
| Tool | built-in tools, MCP servers, permission rules, deferred tools |
| Setting | `settings.json`: permission mode, model, environment |
| Stage | step lists the estate defines, such as a plan, build and verify order or a tracker loop |
| Hazard | compaction, restart, rate limits, mid-turn messages, helper notifications |

| Generic trace field | Claude Code source |
|---|---|
| tools | tool calls in the session transcript (JSONL), the Agent call with its brief as input |
| skills | Skill tool calls |
| guards | the hook decision log, one row per verdict |
| stages | the step feed, when the estate records one |
| executions | Bash calls with exit codes |
| workspace | the diff of the working tree |
