import React from 'react';
import { CheckCircle2, Navigation, Clock, RotateCcw } from 'lucide-react';
import { useDriverStore } from '../../../store/driverStore';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';

export const JourneyCompleted: React.FC = () => {
  const { clearJourney } = useDriverStore();

  return (
    <div className="space-y-5 my-auto text-center py-6">
      <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border-2 border-emerald-500/40 shadow-xl shadow-emerald-950">
        <CheckCircle2 className="w-10 h-10" />
      </div>

      <div>
        <h2 className="text-2xl font-black text-white">Journey Concluded</h2>
        <p className="text-xs text-slate-400 mt-1">Trip records successfully saved to corporate archives.</p>
      </div>

      <Card className="text-left space-y-3">
        <div className="p-3 bg-rose-950/40 border border-rose-900/50 rounded-xl text-xs text-rose-300 font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span>Public Tracking Link Permanently Revoked</span>
        </div>

        <p className="text-xs text-slate-400">
          The unique tracking URL generated for this journey is now completely expired (HTTP 410 Gone). Any external
          viewers have been disconnected.
        </p>
      </Card>

      <Button variant="primary" size="lg" className="w-full" onClick={clearJourney}>
        <RotateCcw className="w-4 h-4" />
        <span>Ready for New Journey</span>
      </Button>
    </div>
  );
};
