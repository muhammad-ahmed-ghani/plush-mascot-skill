"""Shared by the python scripts: project root and mascot.config.json.

    import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
    from config import ROOT, cfg, FRAME, path
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')) + '/'


def load_config(root=ROOT):
    with open(os.path.join(root, 'mascot.config.json'), encoding='utf-8') as f:
        return json.load(f)


cfg = load_config()
FRAME = cfg['frame']                    # size, ppu, axisX, feetY, topY (see the node twin scripts/lib/config.mjs)
FIGURE_HEIGHT_UNITS = (FRAME['feetY'] - FRAME['topY']) / FRAME['ppu']


def path(*parts):
    return os.path.join(ROOT, *parts)
