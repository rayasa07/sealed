"use client";

import { useEffect, useState } from "react";
import { formatRemaining } from "../lib/format";

export function CountdownTimer({
  endTs,
  onElapsed,
  className = "",
}: {
  endTs: number;
  onElapsed?: () => void;
  className?: string;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, []);

  const remaining = endTs - now;
  const elapsed = remaining <= 0;

  useEffect(() => {
    if (elapsed && onElapsed) onElapsed();
  }, [elapsed, onElapsed]);

  return (
    <span className={className}>{formatRemaining(remaining)}</span>
  );
}
