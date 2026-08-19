'use client';

import type { AgentAvailability } from '@/lib/api';
import { AvailabilityEditor } from '@/components/settings/AvailabilityEditor';

type Props = {
  initial: AgentAvailability | null;
  onDone: () => void;
};

export function HoursStep({ initial, onDone }: Props) {
  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">When are you available?</h2>
      <p className="text-sm text-gray-500 mb-5">
        When the AI escalates a chat, it will assign it to whoever is on-duty right now.
        You can add teammates and their hours later from Team settings.
      </p>
      <AvailabilityEditor initial={initial} target="self" onSaved={onDone} />
    </div>
  );
}
