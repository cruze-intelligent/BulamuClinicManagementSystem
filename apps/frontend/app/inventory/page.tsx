'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle } from 'lucide-react';
import {
  listLocalInventory,
  addMedicineOffline,
  cacheInventory,
  getCurrentClinicId,
  subscribeToLocalChanges,
  LocalMedicine,
} from '@/lib/local-first';
import { Select } from '@/components/ui/select';

export default function InventoryPage() {
  const [medicines, setMedicines] = useState<LocalMedicine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    quantity: '',
    unit: 'tablets',
    reorderLevel: '',
    price: '',
    expiryDate: '',
  });
  const [loading, setLoading] = useState(true);

  const loadInventory = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;

    const localData = await listLocalInventory(clinicId);
    setMedicines(localData);
    setLoading(false);

    if (navigator.onLine) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/inventory/${clinicId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.medicines)) {
          await cacheInventory(data.medicines);
          const updated = await listLocalInventory(clinicId);
          setMedicines(updated);
        }
      } catch (err) {
        console.warn('Inventory fetch failed, using local stock:', err);
      }
    }
  };

  useEffect(() => {
    loadInventory();
    const unsubscribe = subscribeToLocalChanges(loadInventory);
    return () => unsubscribe();
  }, []);

  const addMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    const clinicId = getCurrentClinicId() || 'default-clinic';

    try {
      await addMedicineOffline({
        clinicId,
        name: formData.name,
        quantity: parseInt(formData.quantity) || 0,
        unit: formData.unit,
        reorderLevel: parseInt(formData.reorderLevel) || 0,
        price: parseFloat(formData.price) || 0,
        expiryDate: formData.expiryDate || undefined,
      });

      setShowForm(false);
      setFormData({ name: '', quantity: '', unit: 'tablets', reorderLevel: '', price: '', expiryDate: '' });
      loadInventory();
    } catch (error: any) {
      alert(`Error adding medicine: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Pharmacy & Inventory</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Local-First Stock Management</p>
          </div>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Medicine'}
          </Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <form onSubmit={addMedicine} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Medicine Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Coartem 20/120"
                  required
                />
              </div>

              <div>
                <Label htmlFor="quantity">Quantity in Stock</Label>
                <Input
                  id="quantity"
                  type="number"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="unit">Unit</Label>
                <Select
                  id="unit"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="tablets">Tablets</option>
                  <option value="bottles">Bottles</option>
                  <option value="boxes">Boxes</option>
                  <option value="vials">Vials</option>
                  <option value="ml">ML</option>
                </Select>
              </div>

              <div>
                <Label htmlFor="reorderLevel">Reorder Level Threshold</Label>
                <Input
                  id="reorderLevel"
                  type="number"
                  value={formData.reorderLevel}
                  onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="price">Price (UGX)</Label>
                <Input
                  id="price"
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="expiryDate">Expiry Date</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                />
              </div>

              <Button type="submit" className="col-span-2">
                Add to Inventory (Offline Ready)
              </Button>
            </form>
          </Card>
        )}

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading stock levels...</p>
        ) : medicines.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No medicine stock items found. Click above to add medicine to inventory (works offline).
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {medicines.map((med) => (
              <Card key={med.id} className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">{med.name}</h3>
                  {med.syncStatus === 'pending' && (
                    <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                      Pending Sync
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  <p>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Stock:</span>{' '}
                    <span className={med.quantity <= med.reorderLevel ? 'text-rose-600 font-bold' : 'text-slate-800 dark:text-slate-200'}>
                      {med.quantity} {med.unit}
                    </span>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Reorder at:</span> {med.reorderLevel}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Price:</span> UGX {med.price.toLocaleString()}
                  </p>
                  {med.expiryDate && (
                    <p>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Expires:</span>{' '}
                      {new Date(med.expiryDate).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {med.quantity <= med.reorderLevel && (
                  <div className="mt-3 flex items-center gap-1.5 p-2 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs rounded font-medium">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                    Low stock - replenishment required
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}