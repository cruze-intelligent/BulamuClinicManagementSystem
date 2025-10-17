'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/useAuth';
import { useRouter } from 'next/navigation';

export default function SuperAdminPage() {
  const { hasRole } = useAuth();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    adminName: '',
    adminEmail: '',
    adminPassword: ''
  });

  useEffect(() => {
    if (!hasRole('SUPER_ADMIN')) {
      router.push('/dashboard');
    }
  }, [hasRole, router]);

  const createClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();
      if (data.success) {
        alert(`Clinic created! Admin can login with:\nEmail: ${formData.adminEmail}\nPassword: ${formData.adminPassword}`);
        setShowForm(false);
        setFormData({
          name: '',
          phone: '',
          address: '',
          adminName: '',
          adminEmail: '',
          adminPassword: ''
        });
      } else {
        alert('Error creating clinic');
      }
    } catch (error) {
      alert('Error creating clinic');
    }
  };

  if (!hasRole('SUPER_ADMIN')) return null;

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Super Admin Panel 👑</h1>
          <p className="text-muted-foreground">Manage Bulamu clinics and system settings</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card className="p-6">
            <h3 className="text-sm text-muted-foreground">Total Clinics</h3>
            <p className="text-3xl font-bold">2</p>
          </Card>
          <Card className="p-6">
            <h3 className="text-sm text-muted-foreground">Active Users</h3>
            <p className="text-3xl font-bold">5</p>
          </Card>
          <Card className="p-6">
            <h3 className="text-sm text-muted-foreground">Total Revenue</h3>
            <p className="text-3xl font-bold">UGX 600k</p>
          </Card>
        </div>

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Clinic Management</h2>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Create New Clinic'}
          </Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <h3 className="font-bold mb-4">Create New Clinic</h3>
            <form onSubmit={createClinic} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Clinic Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Kampala Medical Center"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Clinic Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="0700123456"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Kampala, Uganda"
                  required
                />
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-semibold mb-3">Clinic Admin Account</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="adminName">Admin Name</Label>
                    <Input
                      id="adminName"
                      value={formData.adminName}
                      onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                      placeholder="Dr. John Doe"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="adminEmail">Admin Email</Label>
                    <Input
                      id="adminEmail"
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                      placeholder="admin@clinic.ug"
                      required
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <Label htmlFor="adminPassword">Admin Password</Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    value={formData.adminPassword}
                    onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                    placeholder="Strong password"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full">Create Clinic & Admin</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}