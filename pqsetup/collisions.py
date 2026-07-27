from __future__ import annotations

import math
from itertools import product
from typing import Literal

import numpy as np
from pydantic import BaseModel
from scipy.spatial import cKDTree

from .models import Collision, Structure


DEFAULT_SAMPLE_LIMIT = 200
_MAX_PERIODIC_IMAGES = 4096


class CollisionScan(BaseModel):
    collisions: list[Collision]
    truncated: bool


def scan_collisions(
    structure: Structure,
    *,
    sample_limit: int = DEFAULT_SAMPLE_LIMIT,
) -> CollisionScan:
    """Return a bounded sample of atomic collisions."""
    if sample_limit < 1:
        raise ValueError("Collision sample limit must be positive.")
    if len(structure.atoms) < 2 and not any(structure.periodic):
        return CollisionScan(collisions=[], truncated=False)

    positions = np.asarray([atom.position for atom in structure.atoms], dtype=float)
    if not np.isfinite(positions).all():
        raise ValueError("All coordinates must be finite.")

    radii = _covalent_radii(structure)
    search_radius = max(0.8, float(radii.max(initial=0.0) * 1.5))
    periodic = (
        bool(structure.periodic[0]),
        bool(structure.periodic[1]),
        bool(structure.periodic[2]),
    )

    if not any(periodic):
        tree = cKDTree(positions)
        return _scan_tree(
            positions,
            radii,
            tree,
            positions,
            np.arange(len(positions)),
            np.zeros(len(positions), dtype=bool),
            sample_limit,
        )

    cell = _valid_cell(structure)
    if _is_orthorhombic(cell) and all(periodic):
        lengths = np.diag(cell)
        wrapped = np.mod(positions, lengths)
        tree = cKDTree(wrapped, boxsize=lengths)
        result = _scan_tree(
            wrapped,
            radii,
            tree,
            wrapped,
            np.arange(len(wrapped)),
            np.zeros(len(wrapped), dtype=bool),
            sample_limit,
            box_lengths=lengths,
        )
        return _add_orthorhombic_self_images(
            result, radii, float(lengths.min()), sample_limit
        )

    return _scan_triclinic(
        positions,
        radii,
        cell,
        periodic,
        search_radius,
        sample_limit,
    )


def _scan_triclinic(
    positions: np.ndarray,
    radii: np.ndarray,
    cell: np.ndarray,
    periodic: tuple[bool, bool, bool],
    search_radius: float,
    sample_limit: int,
) -> CollisionScan:
    inverse = np.linalg.inv(cell)
    fractional = positions @ inverse
    for axis, enabled in enumerate(periodic):
        if enabled:
            fractional[:, axis] %= 1.0
    wrapped = fractional @ cell

    spans: list[int] = []
    for axis, enabled in enumerate(periodic):
        if not enabled:
            spans.append(0)
            continue
        reciprocal_norm = float(np.linalg.norm(inverse[:, axis]))
        spans.append(max(1, math.ceil(search_radius * reciprocal_norm)))

    ranges = [
        range(-span, span + 1) if enabled else (0,)
        for span, enabled in zip(spans, periodic, strict=True)
    ]
    integer_shifts = np.asarray(list(product(*ranges)), dtype=int)
    if len(integer_shifts) > _MAX_PERIODIC_IMAGES:
        raise ValueError("The periodic cell is too skewed for a bounded scan.")

    translations = integer_shifts @ cell
    image_positions = np.concatenate(
        [wrapped + translation for translation in translations]
    )
    atom_indices = np.tile(np.arange(len(wrapped)), len(translations))
    shifted_images = np.repeat(np.any(integer_shifts != 0, axis=1), len(wrapped))
    tree = cKDTree(image_positions)
    return _scan_tree(
        wrapped,
        radii,
        tree,
        image_positions,
        atom_indices,
        shifted_images,
        sample_limit,
    )


def _scan_tree(
    query_positions: np.ndarray,
    radii: np.ndarray,
    tree: cKDTree,
    image_positions: np.ndarray,
    atom_indices: np.ndarray,
    shifted_images: np.ndarray,
    sample_limit: int,
    *,
    box_lengths: np.ndarray | None = None,
) -> CollisionScan:
    search_radius = max(0.8, float(radii.max(initial=0.0) * 1.5))
    samples: dict[tuple[int, int], Collision] = {}

    for atom_i, position in enumerate(query_positions):
        image_neighbors = tree.query_ball_point(position, search_radius)
        candidates: list[tuple[float, int, bool]] = []
        for image_index in image_neighbors:
            atom_j = int(atom_indices[image_index])
            shifted = bool(shifted_images[image_index])
            if atom_i == atom_j and not shifted:
                continue
            delta = image_positions[image_index] - position
            if box_lengths is not None:
                delta -= np.round(delta / box_lengths) * box_lengths
            distance = float(np.linalg.norm(delta))
            candidates.append((distance, atom_j, shifted))

        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        local_minimum: dict[tuple[int, int], float] = {}
        for distance, atom_j, _shifted in candidates:
            key = (
                (atom_i, atom_i)
                if atom_i == atom_j
                else (min(atom_i, atom_j), max(atom_i, atom_j))
            )
            local_minimum[key] = min(distance, local_minimum.get(key, math.inf))

        for key, distance in local_minimum.items():
            atom_j = key[1]
            collision = _classify(
                key[0], atom_j, distance, radii[key[0]], radii[atom_j]
            )
            if collision is None:
                continue
            current = samples.get(key)
            if current is not None:
                if distance < current.distance_angstrom:
                    samples[key] = collision
                continue
            if len(samples) == sample_limit:
                return CollisionScan(
                    collisions=_ordered(samples.values()),
                    truncated=True,
                )
            samples[key] = collision

    return CollisionScan(
        collisions=_ordered(samples.values()),
        truncated=False,
    )


def _classify(
    atom_i: int,
    atom_j: int,
    distance: float,
    radius_i: float,
    radius_j: float,
) -> Collision | None:
    radii_sum = float(radius_i + radius_j)
    hard_threshold = max(0.35, 0.5 * radii_sum)
    warning_threshold = max(0.55, 0.75 * radii_sum)
    if distance < hard_threshold:
        severity: Literal["error", "warning"] = "error"
        threshold = hard_threshold
    elif distance < warning_threshold:
        severity = "warning"
        threshold = warning_threshold
    else:
        return None
    return Collision(
        atom_i=atom_i,
        atom_j=atom_j,
        distance_angstrom=distance,
        threshold_angstrom=threshold,
        severity=severity,
    )


def _add_orthorhombic_self_images(
    result: CollisionScan,
    radii: np.ndarray,
    image_distance: float,
    sample_limit: int,
) -> CollisionScan:
    if result.truncated:
        return result
    collisions = list(result.collisions)
    for atom_index, radius in enumerate(radii):
        collision = _classify(
            atom_index,
            atom_index,
            image_distance,
            radius,
            radius,
        )
        if collision is None:
            continue
        if len(collisions) == sample_limit:
            return CollisionScan(
                collisions=_ordered(collisions),
                truncated=True,
            )
        collisions.append(collision)
    return CollisionScan(
        collisions=_ordered(collisions),
        truncated=False,
    )


def _covalent_radii(structure: Structure) -> np.ndarray:
    from ase.data import atomic_numbers, covalent_radii

    values: list[float] = []
    for atom in structure.atoms:
        try:
            number = atomic_numbers[atom.symbol]
        except KeyError as error:
            raise ValueError(f"Unknown element '{atom.symbol}'.") from error
        values.append(float(covalent_radii[number]))
    return np.asarray(values)


def _valid_cell(structure: Structure) -> np.ndarray:
    if structure.cell is None:
        raise ValueError("A periodic structure needs a cell.")
    cell = np.asarray(structure.cell, dtype=float)
    if (
        cell.shape != (3, 3)
        or not np.isfinite(cell).all()
        or abs(float(np.linalg.det(cell))) < 1e-9
    ):
        raise ValueError("The periodic cell must be finite and non-singular.")
    return cell


def _is_orthorhombic(cell: np.ndarray) -> bool:
    return bool(
        np.all(np.diag(cell) > 0.0)
        and np.allclose(cell, np.diag(np.diag(cell)), atol=1e-12)
    )


def _ordered(collisions) -> list[Collision]:
    return sorted(
        collisions,
        key=lambda item: (
            item.distance_angstrom,
            item.atom_i,
            item.atom_j,
        ),
    )
