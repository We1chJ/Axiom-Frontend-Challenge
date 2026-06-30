import { memo, useCallback } from "react";
import type { Token } from "../types";
import { formatUsd, formatPct } from "../format";

interface TokenRowProps {
  token: Token;
  selected: boolean;
  onSelect: (id: string) => void;
  rankDirection: "up" | "down" | null;
}

function TokenRowComponent({ token, selected, onSelect, rankDirection }: TokenRowProps) {
  const changeClass = token.priceChangePct >= 0 ? "up" : "down";
  const handleClick = useCallback(() => onSelect(token.id), [token.id, onSelect]);

  return (
    <div
      className={`row${selected ? " row--selected" : ""}`}
      onClick={handleClick}
    >
      <div className="row__token">
        <span className="row__name">
          {rankDirection && (
            <span
              className={`row__rank-arrow ${rankDirection}`}
              title={rankDirection === "up" ? "Rank improving" : "Rank dropping"}
            >
              {rankDirection === "up" ? "▲" : "▼"}
            </span>
          )}
          {token.name}
        </span>
        <span className="row__ticker">{token.ticker}</span>
      </div>
      <div className="num">{formatUsd(token.priceUsd)}</div>
      <div className="num col--hide-mobile">{formatUsd(token.marketCapUsd)}</div>
      <div className="num col--hide-mobile">{formatUsd(token.volume24hUsd)}</div>
      <div className="num col--hide-mobile">{formatUsd(token.liquidityUsd)}</div>
      <div className={`num ${changeClass}`}>{formatPct(token.priceChangePct)}</div>
    </div>
  );
}

export const TokenRow = memo(TokenRowComponent, (prev, next) => {
  return (
    prev.token === next.token &&
    prev.selected === next.selected &&
    prev.onSelect === next.onSelect &&
    prev.rankDirection === next.rankDirection
  );
});
