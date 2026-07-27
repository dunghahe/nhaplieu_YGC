import subprocess, os, re

with open('static/app.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def test_range(start, end):
    chunk = ''.join(lines[start:end])
    with open('_check_chunk.js', 'w', encoding='utf-8') as f:
        f.write(chunk)
    result = subprocess.run(
        ['node', '--check', '_check_chunk.js'],
        capture_output=True, text=True, encoding='utf-8', errors='replace'
    )
    return result.returncode == 0, result.stderr

# Narrow down between 2600 and 2700
for start in range(2600, 2710, 10):
    ok, err = test_range(start, start+50)
    if not ok:
        m = re.search(r':(\d+)\n', err)
        rel = int(m.group(1)) if m else 0
        abs_line = start + rel - 1
        print(f'Lines {start}-{start+50}: FAIL at relative {rel} = absolute {abs_line}')
        for i in range(max(0, abs_line-3), min(len(lines), abs_line+3)):
            print(f'  {i+1}: {lines[i].rstrip()}')
        break
    else:
        print(f'Lines {start}-{start+50}: OK')

os.remove('_check_chunk.js')
