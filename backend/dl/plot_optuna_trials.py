"""Visualisation des trials Optuna sous forme de scatter, contour, box plot ou parallel coordinates.

Exemples:
    python backend/dl/plot_optuna_trials.py --plot-type contour --x n_layers --y lstm_units --z combined_score_t30min
    python backend/dl/plot_optuna_trials.py --plot-type scatter --x learning_rate --y dropout_rate --z avg_correlation_t30min
    python backend/dl/plot_optuna_trials.py --plot-type parallel --columns smoothing_window n_layers lstm_units dropout_rate learning_rate combined_score_t30min
    python backend/dl/plot_optuna_trials.py --list-columns

Remarque:
    Les métriques Optuna calculées par trial peuvent être lues directement si elles ont été
    stockées dans trial.user_attrs, par exemple `avg_correlation_t30min`,
    `avg_normalized_mae_t30min` ou `combined_score_t30min`.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.tri as mtri
import numpy as np
import optuna
import pandas as pd
from matplotlib.colors import BoundaryNorm
from pandas.api.types import is_numeric_dtype


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "assets" / "ml_models" / "optuna_lstm_study.db"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "assets" / "ml_models" / "optuna_plots"
DEFAULT_STUDY_NAME = "IAQ_LSTM_HPO_CORR_ALL_SENSORS_V1"
DEFAULT_Z_COLUMN = "combined_score_t30min"


def resolve_study_name(db_path: Path, requested_study_name: str) -> str:
    """Résout le nom du study à ouvrir, avec fallback intelligent si nécessaire."""
    storage = f"sqlite:///{db_path.as_posix()}"
    summaries = optuna.get_all_study_summaries(storage=storage)
    if not summaries:
        raise RuntimeError(f"Aucune étude Optuna trouvée dans {db_path}")

    available_names = [summary.study_name for summary in summaries]
    if requested_study_name in available_names:
        return requested_study_name

    completed_candidates = [summary for summary in summaries if summary.n_trials > 0]
    if not completed_candidates:
        fallback_name = summaries[-1].study_name
    else:
        completed_candidates.sort(
            key=lambda summary: summary.datetime_start or pd.Timestamp.min.to_pydatetime()
        )
        fallback_name = completed_candidates[-1].study_name

    if requested_study_name == DEFAULT_STUDY_NAME:
        print(
            f"Study par défaut introuvable: {requested_study_name}. "
            f"Fallback automatique vers: {fallback_name}"
        )
        return fallback_name

    available_str = ", ".join(sorted(available_names))
    raise KeyError(
        f"Étude introuvable: {requested_study_name}. Études disponibles: {available_str}"
    )


def compute_cell_edges(values: np.ndarray) -> np.ndarray:
    """Calcule des bords de cellules pour un rendu heatmap discret."""
    unique_vals = np.unique(np.sort(values.astype(float)))
    if len(unique_vals) == 1:
        return np.array([unique_vals[0] - 0.5, unique_vals[0] + 0.5])

    midpoints = (unique_vals[:-1] + unique_vals[1:]) / 2
    first_edge = unique_vals[0] - (midpoints[0] - unique_vals[0])
    last_edge = unique_vals[-1] + (unique_vals[-1] - midpoints[-1])
    return np.concatenate(([first_edge], midpoints, [last_edge]))


def compute_discrete_boundaries(values: np.ndarray, max_levels: int = 9) -> np.ndarray:
    """Construit des bornes discrètes pour une colorbar à paliers."""
    finite_values = np.sort(np.unique(values[np.isfinite(values)].astype(float)))
    if len(finite_values) == 0:
        raise RuntimeError("Impossible de construire des bornes discrètes sans valeurs finies.")

    if len(finite_values) == 1:
        center = finite_values[0]
        return np.array([center - 0.5, center + 0.5])

    if len(finite_values) <= max_levels:
        midpoints = (finite_values[:-1] + finite_values[1:]) / 2
        first_edge = finite_values[0] - (midpoints[0] - finite_values[0])
        last_edge = finite_values[-1] + (finite_values[-1] - midpoints[-1])
        return np.concatenate(([first_edge], midpoints, [last_edge]))

    return np.linspace(finite_values.min(), finite_values.max(), num=max_levels + 1)


def should_desc_sort(metric_name: str) -> bool:
    """Retourne True si la métrique doit être triée du plus grand au plus petit."""
    metric_name = metric_name.lower()
    descending_markers = [
        "score",
        "corr",
        "correlation",
        "accuracy",
        "acc",
        "auc",
        "r2",
        "value",
    ]
    ascending_markers = ["mae", "rmse", "mape", "loss", "error", "nmae"]

    if any(marker in metric_name for marker in ascending_markers):
        return False
    if any(marker in metric_name for marker in descending_markers):
        return True
    return True


def load_trials_dataframe(db_path: Path, study_name: str) -> pd.DataFrame:
    resolved_study_name = resolve_study_name(db_path, study_name)
    study = optuna.load_study(
        study_name=resolved_study_name,
        storage=f"sqlite:///{db_path.as_posix()}",
    )

    rows = []
    for trial in study.trials:
        row = {
            "number": trial.number,
            "value": trial.value,
            "state": trial.state.name,
        }

        if trial.datetime_start is not None and trial.datetime_complete is not None:
            row["duration_seconds"] = (
                trial.datetime_complete - trial.datetime_start
            ).total_seconds()

        for key, value in trial.params.items():
            row[key] = value

        for key, value in trial.user_attrs.items():
            row[key] = value
            row[f"user_{key}"] = value

        rows.append(row)

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError("Aucun trial trouvé dans l'étude Optuna.")

    df = df[df["state"] == "COMPLETE"].copy()
    if df.empty:
        raise RuntimeError("Aucun trial COMPLETE disponible dans l'étude Optuna.")

    return df.sort_values("number").reset_index(drop=True)


def encode_series(series: pd.Series) -> tuple[np.ndarray, dict[int, str] | None]:
    if is_numeric_dtype(series):
        return series.to_numpy(dtype=float), None

    categorical = pd.Categorical(series.astype(str))
    values = categorical.codes.astype(float)
    labels = {idx: label for idx, label in enumerate(categorical.categories)}
    return values, labels


def apply_axis_labels(ax, axis_name: str, labels: dict[int, str] | None, axis: str) -> None:
    if not labels:
        return

    ticks = list(labels.keys())
    tick_labels = [labels[idx] for idx in ticks]
    if axis == "x":
        ax.set_xticks(ticks)
        ax.set_xticklabels(tick_labels)
    elif axis == "y":
        ax.set_yticks(ticks)
        ax.set_yticklabels(tick_labels)
    elif axis == "colorbar":
        pass
    ax.set_xlabel(axis_name if axis == "x" else ax.get_xlabel())
    ax.set_ylabel(axis_name if axis == "y" else ax.get_ylabel())


def validate_columns(df: pd.DataFrame, columns: list[str]) -> None:
    missing = [column for column in columns if column not in df.columns]
    if missing:
        available = ", ".join(sorted(df.columns))
        raise ValueError(f"Colonnes introuvables: {missing}. Disponibles: {available}")


def plot_scatter(df: pd.DataFrame, x: str, y: str, z: str, output_path: Path) -> None:
    validate_columns(df, [x, y, z])
    plot_df = df[[x, y, z, "number"]].dropna().copy()
    if plot_df.empty:
        raise RuntimeError("Aucune donnée exploitable pour le scatter plot.")

    x_values, x_labels = encode_series(plot_df[x])
    y_values, y_labels = encode_series(plot_df[y])
    z_values = pd.to_numeric(plot_df[z], errors="coerce").to_numpy(dtype=float)

    fig, ax = plt.subplots(figsize=(12, 8))
    scatter = ax.scatter(
        x_values,
        y_values,
        c=z_values,
        cmap="viridis",
        s=90,
        alpha=0.85,
        edgecolors="black",
        linewidths=0.4,
    )

    for _, row in plot_df.iterrows():
        ax.annotate(str(int(row["number"])), (encode_series(pd.Series([row[x]]))[0][0], encode_series(pd.Series([row[y]]))[0][0]), fontsize=8, alpha=0.7)

    ax.set_title(f"Optuna Scatter Plot: {z} selon {x} et {y}")
    ax.set_xlabel(x)
    ax.set_ylabel(y)
    apply_axis_labels(ax, x, x_labels, "x")
    apply_axis_labels(ax, y, y_labels, "y")
    cbar = fig.colorbar(scatter, ax=ax)
    cbar.set_label(z)
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_contour(df: pd.DataFrame, x: str, y: str, z: str, output_path: Path) -> None:
    validate_columns(df, [x, y, z])
    plot_df = df[[x, y, z]].dropna().copy()
    if plot_df.empty:
        raise RuntimeError("Aucune donnée exploitable pour le contour plot.")

    x_values, x_labels = encode_series(plot_df[x])
    y_values, y_labels = encode_series(plot_df[y])
    z_values = pd.to_numeric(plot_df[z], errors="coerce").to_numpy(dtype=float)

    fig, ax = plt.subplots(figsize=(12, 8))

    grouped = (
        pd.DataFrame({"x": x_values, "y": y_values, "z": z_values})
        .groupby(["x", "y"], as_index=False)["z"]
        .mean()
        .sort_values(["y", "x"])
    )

    if len(grouped) < 3:
        raise RuntimeError("Au moins 3 points distincts sont nécessaires pour un contour triangulé.")

    color_boundaries = compute_discrete_boundaries(grouped["z"].to_numpy(dtype=float))
    color_norm = BoundaryNorm(color_boundaries, ncolors=plt.get_cmap("viridis").N, clip=True)
    triangulation = mtri.Triangulation(
        grouped["x"].to_numpy(dtype=float),
        grouped["y"].to_numpy(dtype=float),
    )

    contour = ax.tricontourf(
        triangulation,
        grouped["z"].to_numpy(dtype=float),
        levels=color_boundaries,
        cmap="viridis",
        norm=color_norm,
    )
    cbar = fig.colorbar(contour, ax=ax, boundaries=color_boundaries, ticks=color_boundaries)
    ax.scatter(grouped["x"], grouped["y"], c="white", s=36, alpha=0.95, edgecolors="black", linewidths=0.4)

    for _, row in grouped.iterrows():
        if np.isfinite(row["z"]):
            ax.text(
                row["x"],
                row["y"],
                f"{row['z']:.3f}",
                ha="center",
                va="center",
                fontsize=8,
                color="black",
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.7, "pad": 1.5},
            )

    cbar.set_label(z)
    cbar.ax.set_yticklabels([f"{tick:.3f}" for tick in color_boundaries])
    ax.set_title(f"Optuna Contour Plot: {z} selon {x} et {y}")
    ax.set_xlabel(x)
    ax.set_ylabel(y)
    apply_axis_labels(ax, x, x_labels, "x")
    apply_axis_labels(ax, y, y_labels, "y")
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_parallel(df: pd.DataFrame, columns: list[str], output_path: Path) -> None:
    validate_columns(df, columns)
    plot_df = df[columns].dropna().copy()
    if plot_df.empty:
        raise RuntimeError("Aucune donnée exploitable pour le parallel coordinates plot.")

    encoded_df = pd.DataFrame(index=plot_df.index)
    tick_maps: dict[str, dict[int, str]] = {}
    for column in columns:
        values, labels = encode_series(plot_df[column])
        encoded_df[column] = values
        if labels:
            tick_maps[column] = labels

    fig, ax = plt.subplots(figsize=(14, 8))
    x_positions = np.arange(len(columns))
    norm_df = encoded_df.copy()

    for column in columns:
        col_min = encoded_df[column].min()
        col_max = encoded_df[column].max()
        if np.isclose(col_min, col_max):
            norm_df[column] = 0.5
        else:
            norm_df[column] = (encoded_df[column] - col_min) / (col_max - col_min)

    for _, row in norm_df.iterrows():
        ax.plot(x_positions, row.to_numpy(dtype=float), alpha=0.35, color="#1f77b4")

    ax.set_xticks(x_positions)
    ax.set_xticklabels(columns, rotation=15)
    ax.set_yticks([])
    ax.set_title("Optuna Parallel Coordinates")
    ax.grid(axis="x", alpha=0.25)

    for idx, column in enumerate(columns):
        if column in tick_maps:
            labels = tick_maps[column]
            ymin, ymax = encoded_df[column].min(), encoded_df[column].max()
            if not np.isclose(ymin, ymax):
                for code, label in labels.items():
                    y_norm = (code - ymin) / (ymax - ymin)
                    ax.text(idx, y_norm, str(label), fontsize=8, ha="left", va="bottom")

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_box(df: pd.DataFrame, x: str, z: str, output_path: Path) -> None:
    validate_columns(df, [x, z])
    plot_df = df[[x, z]].dropna().copy()
    if plot_df.empty:
        raise RuntimeError("Aucune donnée exploitable pour le box plot.")

    plot_df[z] = pd.to_numeric(plot_df[z], errors="coerce")
    plot_df = plot_df.dropna(subset=[z])
    grouped = [group[z].to_numpy(dtype=float) for _, group in plot_df.groupby(x)]
    labels = [str(label) for label, _ in plot_df.groupby(x)]

    fig, ax = plt.subplots(figsize=(12, 8))
    ax.boxplot(grouped, labels=labels, patch_artist=True)
    ax.set_title(f"Optuna Box Plot: distribution de {z} par {x}")
    ax.set_xlabel(x)
    ax.set_ylabel(z)
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def build_output_path(output_dir: Path, plot_type: str, x: str | None, y: str | None, z: str | None) -> Path:
    parts = [plot_type]
    if x:
        parts.append(x)
    if y:
        parts.append(y)
    if z:
        parts.append(z)
    filename = "_".join(parts) + ".png"
    return output_dir / filename


def main() -> None:
    parser = argparse.ArgumentParser(description="Visualise les trials Optuna de l'étude LSTM")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="Chemin vers la base SQLite Optuna")
    parser.add_argument("--study-name", default=DEFAULT_STUDY_NAME, help="Nom de l'étude Optuna")
    parser.add_argument("--plot-type", choices=["scatter", "contour", "parallel", "box"], default="contour")
    parser.add_argument("--x", help="Colonne X (paramètre ou métrique)")
    parser.add_argument("--y", help="Colonne Y (paramètre ou métrique)")
    parser.add_argument("--z", default=DEFAULT_Z_COLUMN, help="Colonne Z / couleur")
    parser.add_argument("--columns", nargs="+", help="Colonnes pour le parallel plot")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Dossier de sortie des images")
    parser.add_argument("--list-columns", action="store_true", help="Afficher les colonnes disponibles et quitter")
    args = parser.parse_args()

    db_path = Path(args.db_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_trials_dataframe(db_path=db_path, study_name=args.study_name)

    if args.list_columns:
        print("Colonnes disponibles:")
        for column in sorted(df.columns):
            print(f"- {column}")
        return

    if args.z and args.z not in df.columns:
        available = ", ".join(sorted(df.columns))
        raise ValueError(f"Colonne Z introuvable: {args.z}. Disponibles: {available}")

    if args.plot_type in {"scatter", "contour"} and (not args.x or not args.y):
        raise ValueError("Les options --x et --y sont obligatoires pour scatter et contour.")

    if args.plot_type == "parallel":
        columns = args.columns or [
            "smoothing_window",
            "n_layers",
            "lstm_units",
            "dropout_rate",
            "learning_rate",
            DEFAULT_Z_COLUMN,
        ]
        output_path = build_output_path(output_dir, args.plot_type, None, None, None)
        plot_parallel(df, columns=columns, output_path=output_path)
    elif args.plot_type == "box":
        if not args.x:
            raise ValueError("L'option --x est obligatoire pour box.")
        output_path = build_output_path(output_dir, args.plot_type, args.x, None, args.z)
        plot_box(df, x=args.x, z=args.z, output_path=output_path)
    elif args.plot_type == "scatter":
        output_path = build_output_path(output_dir, args.plot_type, args.x, args.y, args.z)
        plot_scatter(df, x=args.x, y=args.y, z=args.z, output_path=output_path)
    else:
        output_path = build_output_path(output_dir, args.plot_type, args.x, args.y, args.z)
        plot_contour(df, x=args.x, y=args.y, z=args.z, output_path=output_path)

    if should_desc_sort(args.z):
        top_trials = df[["number", args.z]].dropna().sort_values(args.z, ascending=False).head(5)
    else:
        top_trials = df[["number", args.z]].dropna().sort_values(args.z, ascending=True).head(5)

    print(f"Plot généré: {output_path}")
    if not top_trials.empty:
        print("Top trials:")
        print(top_trials.to_string(index=False))


if __name__ == "__main__":
    main()