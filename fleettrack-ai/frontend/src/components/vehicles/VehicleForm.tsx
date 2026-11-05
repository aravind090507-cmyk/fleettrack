import React, { useState, useEffect } from 'react';
import { Vehicle, VehicleType, VehicleStatus, Project, User } from '../../types';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { isValidRegistration } from '../../utils/validators';

interface VehicleFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Vehicle>) => Promise<void>;
  initialData?: Vehicle | null;
  projects?: Project[];
  managers?: User[];
  isLoading?: boolean;
}

export function VehicleForm({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  projects = [],
  managers = [],
  isLoading = false,
}: VehicleFormProps) {
  const [registration, setRegistration] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('dump_truck');
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState<VehicleStatus>('active');
  const [projectId, setProjectId] = useState<string>('');
  const [managerId, setManagerId] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEditMode = Boolean(initialData);

  useEffect(() => {
    if (initialData) {
      setRegistration(initialData.registration_number || '');
      setVehicleType(initialData.vehicle_type || 'dump_truck');
      setDeviceId(initialData.device_id || '');
      setStatus(initialData.status || 'active');
      setProjectId(initialData.assigned_project_id || '');
      setManagerId(initialData.assigned_manager_id || '');
    } else {
      setRegistration('');
      setVehicleType('dump_truck');
      setDeviceId(`GPS-${Math.floor(1000 + Math.random() * 9000)}`);
      setStatus('active');
      setProjectId('');
      setManagerId('');
    }
    setErrors({});
  }, [initialData, isOpen]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!isValidRegistration(registration)) {
      newErrors.registration = 'Registration must be at least 3 characters.';
    }
    if (!deviceId.trim()) {
      newErrors.deviceId = 'Device ID is required for GPS tracking.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await onSubmit({
        registration_number: registration.trim().toUpperCase(),
        vehicle_type: vehicleType,
        device_id: deviceId.trim(),
        status,
        assigned_project_id: projectId ? projectId : null,
        assigned_manager_id: managerId ? managerId : null,
      });
      onClose();
    } catch {
      // Handled by mutation
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Vehicle' : 'Add New Vehicle'}
      description="Enter vehicle specifications and assign device tracking hardware."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Registration Number *"
          placeholder="e.g. TRK-402, CAT-789"
          value={registration}
          onChange={(e) => setRegistration(e.target.value)}
          error={errors.registration}
          autoFocus
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Vehicle Type *"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value as VehicleType)}
          >
            <option value="dump_truck">Dump Truck</option>
            <option value="excavator">Excavator</option>
            <option value="concrete_mixer">Concrete Mixer</option>
            <option value="loader">Wheel Loader</option>
            <option value="crane_truck">Crane Truck</option>
          </Select>

          <Select
            label="Initial Status *"
            value={status}
            onChange={(e) => setStatus(e.target.value as VehicleStatus)}
          >
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="moving">Moving</option>
            <option value="maintenance">Maintenance</option>
            <option value="offline">Offline</option>
          </Select>
        </div>

        <Input
          label="GPS Device ID / Hardware Serial *"
          placeholder="e.g. GPS-9942"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          error={errors.deviceId}
          helperText="Hardware identifier used by GPS transmitters or simulated feed."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Assigned Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">None (Unassigned)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>

          <Select
            label="Fleet Manager"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
          >
            <option value="">None (Unassigned)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.email})
              </option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700/80">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            {isEditMode ? 'Save Changes' : 'Create Vehicle'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default VehicleForm;
