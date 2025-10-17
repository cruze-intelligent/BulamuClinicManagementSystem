'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function InventoryPage() {
  const [medicines, setMedicines] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    quantity: '',
    unit: 'tablets',
    reorderLevel: '',
    price: '',
    expiryDate: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/inventory/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) setMedicines(data.medicines);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const addMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/inventory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          clinicId: user.clinicId,
          quantity: parseInt(formData.quantity),
          reorderLevel: parseInt(formData.reorderLevel),
          price: parseFloat(formData.price)
        })
      });

      alert('Medicine added!');
      setShowForm(false);
      setFormData({ name: '', quantity: '', unit: 'tablets', reorderLevel: '', price: '', expiryDate: '' });
      fetchInventory();
    } catch (error) {
      alert('Error adding medicine');
    }
  };

  const updateQuantity = async (id: string, currentQty: number) => {
    const newQty = prompt('Enter new quantity:', currentQty.toString());
    if (!newQty) return;

    const token = localStorage.getItem('token');

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/inventory/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ quantity: parseInt(newQty) })
      });

      fetchInventory();
    } catch (error) {
      alert('Error updating quantity');
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Inventory 💊</h1>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Medicine'}
          </Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <form onSubmit={addMedicine} className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Medicine Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Paracetamol"
                  required
                />
              </div>

              <div>
                <Label htmlFor="quantity">Quantity</Label>
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
                <select
                  id="unit"
                  className="w-full p-2 border rounded"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="tablets">Tablets</option>
                  <option value="bottles">Bottles</option>
                  <option value="boxes">Boxes</option>
                  <option value="ml">ML</option>
                </select>
              </div>

              <div>
                <Label htmlFor="reorderLevel">Reorder Level</Label>
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

              <Button type="submit" className="col-span-2">Add to Inventory</Button>
            </form>
          </Card>
        )}

        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {medicines.map((med: any) => (
              <Card key={med.id} className="p-4">
                <h3 className="font-bold text-lg mb-2">{med.name}</h3>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-semibold">Stock:</span>{' '}
                    <span className={med.quantity <= med.reorderLevel ? 'text-red-600 font-bold' : ''}>
                      {med.quantity} {med.unit}
                    </span>
                  </p>
                  <p><span className="font-semibold">Reorder at:</span> {med.reorderLevel}</p>
                  <p><span className="font-semibold">Price:</span> UGX {med.price.toLocaleString()}</p>
                  {med.expiryDate && (
                    <p><span className="font-semibold">Expires:</span> {new Date(med.expiryDate).toLocaleDateString()}</p>
                  )}
                </div>
                
                {med.quantity <= med.reorderLevel && (
                  <div className="mt-2 p-2 bg-red-50 text-red-600 text-xs rounded">
                    ⚠️ Low stock - Reorder soon!
                  </div>
                )}

                <Button 
                  size="sm" 
                  className="w-full mt-3"
                  onClick={() => updateQuantity(med.id, med.quantity)}
                >
                  Update Quantity
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}