from __future__ import annotations

import random
import unicodedata

import jiwer


def normalize(text: str) -> str:
    folded = unicodedata.normalize("NFC", text).lower()
    spaced = "".join(" " if unicodedata.category(char)[0] in "PS" else char for char in folded)
    return " ".join(spaced.split())


def error_rates(refs: list[str], hyps: list[str]) -> tuple[float, float]:
    clean_refs = [normalize(ref) for ref in refs]
    clean_hyps = [normalize(hyp) or "<empty>" for hyp in hyps]
    return jiwer.wer(clean_refs, clean_hyps), jiwer.cer(clean_refs, clean_hyps)


def utterance_counts(refs: list[str], hyps: list[str]) -> list[tuple[int, int]]:
    counts = []
    for ref, hyp in zip(refs, hyps):
        output = jiwer.process_words(normalize(ref), normalize(hyp) or "<empty>")
        counts.append((output.substitutions + output.deletions + output.insertions, len(normalize(ref).split())))
    return counts


def bootstrap_interval(counts: list[tuple[int, int]], rounds: int = 2000, seed: int = 7) -> tuple[float, float]:
    generator = random.Random(seed)
    rates = []
    for _ in range(rounds):
        sample = [generator.choice(counts) for _ in counts]
        rates.append(sum(errors for errors, _ in sample) / sum(words for _, words in sample))
    rates.sort()
    return rates[int(0.025 * rounds)], rates[int(0.975 * rounds) - 1]
