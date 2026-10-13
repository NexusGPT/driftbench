"""Independent coordinate checks. No model output or preferred answer is an input."""
import json
import math
from fractions import Fraction

# Unit cube; ACGE is x=y. J lies on AD's line and outside the cube.
J = (0, -1, 1)
cube_distance_squared = sum(max(0, -x, x - 1) ** 2 for x in J)
plane_distance_squared = Fraction((J[0] - J[1]) ** 2, 2)
assert cube_distance_squared == 1
assert plane_distance_squared == Fraction(1, 2)
cube_cases = []
for r in [Fraction(1, 2), Fraction(4, 5)]:
    assert r * r < cube_distance_squared  # Sphere cannot overlap the cube.
    cut = r * r > plane_distance_squared
    cube_cases.append({
        "center": J, "radius": str(r), "sphere_cut": cut,
        "cube_pieces": 2, "sphere_pieces": 2 if cut else 1,
        "total": 4 if cut else 3,
    })
assert {c["total"] for c in cube_cases} == {3, 4}

# Square above AB; equilateral triangle below AB so interiors do not overlap.
A, B, C, D = (0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)
E = (0.5, -math.sqrt(3) / 2)
F, G = A, B
t = -E[1] / (C[1] - E[1])
P = (E[0] + t * (C[0] - E[0]), 0.0)
assert 0 < t < 1 and 0 < P[0] < 1
assert math.isclose(P[0], math.sqrt(3) - 1)
def area(poly):
    return abs(sum(x * poly[(i + 1) % len(poly)][1] - y * poly[(i + 1) % len(poly)][0]
                   for i, (x, y) in enumerate(poly))) / 2
assert all(math.isclose(math.dist(u, v), 1) for u, v in [(E, F), (E, G), (F, G)])
pieces = [(E, F, P), (E, P, G), (P, B, C), (A, P, C, D)]
assert all(area(poly) > 0 for poly in pieces)
assert math.isclose(sum(area(poly) for poly in pieces[:2]), area((E, F, G)))
assert math.isclose(sum(area(poly) for poly in pieces[2:]), 1)
triangles = sum(len(poly) == 3 for poly in pieces)
assert triangles == 3
print(json.dumps({
    "cube_sphere": {"plane": "x=y", "distance_to_cube_squared": cube_distance_squared,
                    "distance_to_plane_squared": str(plane_distance_squared), "cases": cube_cases},
    "square_triangle": {"cut_point": P, "piece_vertex_counts": list(map(len, pieces)),
                        "triangles": triangles, "areas": list(map(area, pieces)), "area_conserved": True},
    "all_independent_assertions_pass": True,
}, indent=2))
