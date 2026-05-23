# Issue tracker: GitHub (fork)

Issues and PRDs for multi-agent and fork work live on **kartikkabadi/remodex**, not upstream Emanuele-web04/remodex.

Use the `gh` CLI for all operations. **Always pass `--repo kartikkabadi/remodex`** so issues land on the fork.

## Conventions

- **Create an issue**: `gh issue create --repo kartikkabadi/remodex --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo kartikkabadi/remodex --comments`
- **List issues**: `gh issue list --repo kartikkabadi/remodex --state open`
- **Comment on an issue**: `gh issue comment <number> --repo kartikkabadi/remodex --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo kartikkabadi/remodex --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo kartikkabadi/remodex --comment "..."`

## When a skill says "publish to the issue tracker"

Create a GitHub issue on **kartikkabadi/remodex**.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo kartikkabadi/remodex --comments`.
