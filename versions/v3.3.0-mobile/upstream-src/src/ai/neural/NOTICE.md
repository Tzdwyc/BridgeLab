BridgeLab Phase A neural inference was independently written from the author definitions:
- BRL fdd958ff8adcb44844d70ea2e233bed18d5a7b70, src/models.py, Apache-2.0.
- PGX v1.4.0 ee25d42322c4c58847859ed2afb1795cf7fc0adc, pgx/bridge_bidding.py, Apache-2.0.
- OpenSpiel v1.4 03cf55f55daeab350e5b29ca240a0865b43fc789, Apache-2.0.

Author source and licenses are preserved at resources/neural-bidding-2026-10-13.
Model weights: original BRL Apache-2.0 parameters; flat binary resources extracted
from the pinned Nickel archive are verified tensor-by-tensor against originals.
The Nickel repository has no repository-level license in this snapshot. Its
TypeScript model/encoder application source was not copied or imported.
The conversion script was inspected only to understand its pickle layout; the
Phase A reader uses a new strict global allowlist instead of its permissive loader.

This is a research module, not a claim that SAYC learned by BRL follows BridgeLab's
modified bidding system. chooseLegal applies legality only, preserving raw logits.
