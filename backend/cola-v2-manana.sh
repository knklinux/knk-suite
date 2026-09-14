#!/usr/bin/env bash
# cola-v2-manana.sh — Lanza la secuencia V2 del 08-sep y muestra los veredictos de cada fase.
# Uso: bash backend/cola-v2-manana.sh   (o programarlo con el Programador de tareas)
cd "$(dirname "$0")/.."
echo "═══ V2 — $(date) ═══"
bash backend/secuencia-post-enfriamiento.sh
echo "═══ FIN V2 — $(date) ═══"
