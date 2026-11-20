import { randomInt } from 'node:crypto';

export interface Connection { sender: number; receiver: number }

// Ein gerichteter Ring gibt jeder Gruppe genau einen Sende- und Empfangspartner.
export function nextConnections(groups: number[], previous: Connection[] = []): Connection[] {
  if (![2,4,6].includes(groups.length) || new Set(groups).size !== groups.length) throw new Error('Es werden 2, 4 oder 6 unterschiedliche Gruppen benötigt.');
  if (groups.length === 2) return [{sender:groups[0],receiver:groups[1]},{sender:groups[1],receiver:groups[0]}];
  const candidates: Connection[][] = [];
  function permute(prefix: number[], remaining: number[]) {
    if (!remaining.length) {
      const edges = prefix.map((sender,i)=>({sender,receiver:prefix[(i+1)%prefix.length]}));
      if (edges.every(edge=>!previous.some(old=>old.sender===edge.sender && old.receiver===edge.receiver))) candidates.push(edges);
      return;
    }
    remaining.forEach((group,i)=>permute([...prefix,group],remaining.filter((_,j)=>j!==i)));
  }
  permute([groups[0]],groups.slice(1));
  if (!candidates.length) throw new Error('Es konnte keine neue Funkverteilung erstellt werden.');
  return candidates[randomInt(candidates.length)];
}
