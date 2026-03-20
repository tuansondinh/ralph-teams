import sys

def patch():
    with open('ralph.sh', 'r') as f:
        content = f.read()

    old_claude = """    claude)
      echo "$prompt" | $AGENT_CMD --agent "$agent_name" --model "$model" --dangerously-skip-permissions --print --verbose --output-format stream-json > "$log_file" 2>&1 || true
      ;;"""
    new_claude = """    claude)
      (
        cd "$workdir" || exit 1
        echo "$prompt" | $AGENT_CMD --agent "$agent_name" --model "$model" --dangerously-skip-permissions --print --verbose --output-format stream-json > "$log_file" 2>&1 || true
      )
      ;;"""
    
    old_copilot = """    copilot)
      COPILOT_ROLE_PROMPT="$prompt" \\
        script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent "$0" --allow-all --no-ask-user --stream on -p "$1"' \\
        "$agent_name" "$COPILOT_ROLE_PROMPT" \\
        > "$log_file" 2>&1 || true
      ;;"""
    new_copilot = """    copilot)
      (
        cd "$workdir" || exit 1
        COPILOT_ROLE_PROMPT="$prompt" \\
          script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent "$0" --allow-all --no-ask-user --stream on -p "$1"' \\
          "$agent_name" "$COPILOT_ROLE_PROMPT" \\
          > "$log_file" 2>&1 || true
      )
      ;;"""
    
    content = content.replace(old_claude, new_claude)
    content = content.replace(old_copilot, new_copilot)
    
    with open('ralph.sh', 'w') as f:
        f.write(content)

patch()
