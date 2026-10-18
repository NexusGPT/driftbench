# LiveBench graders (vendored)

Source: https://github.com/LiveBench/LiveBench at commit c50a43c82815fe7a7793727fd94971332e33a54b, Apache License 2.0 (LICENSE in this folder).

| File here | Upstream path |
|---|---|
| util.py | livebench/process_results/util.py |
| math_competitions.py | livebench/process_results/math/math_competitions/utils.py |
| zebra_puzzle.py | livebench/process_results/reasoning/zebra_puzzle/utils.py |
| spatial.py | livebench/process_results/reasoning/spatial/utils.py |
| web_of_lies_v2.py | livebench/process_results/reasoning/web_of_lies_v2/utils.py |

The only change: the line `from livebench.process_results.util import` reads `from .util import`. upstream.sha256 holds the hashes of the files as downloaded, before that change.
