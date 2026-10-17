import json
import pathlib
import sys
source = json.loads(pathlib.Path('artifacts/v033-release6b-auctions.json').read_text(encoding='utf-8-sig'))
records = {}
for line in pathlib.Path('artifacts/v033-release6b-root-authored.txt').read_text(encoding='utf-8-sig').splitlines():
    if not line.strip() or line.startswith('#'):
        continue
    board, steps, cv, mv, reason = line.split(' ', 4)
    if cv != 'ok' or mv != 'ok':
        records.setdefault(int(board), []).append((steps, cv, mv, reason))
selected = list(records)[int(sys.argv[1]):int(sys.argv[1])+int(sys.argv[2])]
for b in source['boards']:
    if b['board'] not in selected:
        continue
    print('BOARD', b['board'], b['dealer'], b['vulnerability'])
    hands = {s['seat']: (s['hand'], s['hcp']) for s in b['steps']}
    print('HANDS', hands)
    print('FULL', ' '.join(f"{s['step']}:{s['seat']}:{s['call']}" for s in b['steps']))
    for s in b['steps']:
        if s['call'] != 'P':
            print(s['step'], s['meaning'])
    print('FLAGS', records[b['board']])
print('TOTAL-FLAGGED-BOARDS', len(records))
