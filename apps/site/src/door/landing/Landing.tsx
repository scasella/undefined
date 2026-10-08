/** The landing page (Round 3 · Front door · landing). Sections are one file each; this only orders them. */
import type { Engine } from '@scasella/undefined-engine/types';
import { AgreeFirst } from './AgreeFirst';
import { AgreeOnce } from './AgreeOnce';
import { Asks } from './Asks';
import { EvidenceStrip } from './EvidenceStrip';
import { Hero } from './Hero';
import { Ladder } from './Ladder';
import { OrderOfWork } from './OrderOfWork';
import { SaysNoAndPrivacy } from './SaysNoAndPrivacy';
import { Stage } from './Stage';
import { TeamFile } from './TeamFile';

export function Landing({ engine }: { engine: Engine }) {
  return (
    <>
      <Hero />
      <Stage engine={engine} />
      <AgreeFirst engine={engine} />
      <EvidenceStrip />
      <OrderOfWork />
      <Ladder />
      <AgreeOnce />
      <Asks />
      <SaysNoAndPrivacy engine={engine} />
      <TeamFile />
    </>
  );
}
