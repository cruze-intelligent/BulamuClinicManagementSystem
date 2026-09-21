'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { roleLabel } from '@/lib/role-labels';
import { Select } from '@/components/ui/select';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    role: 'STAFF'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/users/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) setUsers(data.users);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            ...formData,
            clinicId: currentUser.clinicId
        })
        });

        const data = await response.json();
        if (data.success) {
        alert('User added!');
        setShowForm(false);
        setFormData({ email: '', password: '', name: '', role: 'DOCTOR' });
        fetchUsers();
        } else {
        alert(`Error: ${data.error || 'Failed to add user'}`);
        }
    } catch (error: any) {
        console.error('Add user error:', error);
        alert('Error adding user. Check console for details.');
    }
    };
  const deactivateUser = async (id: string) => {
    const token = localStorage.getItem('token');

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/${id}/deactivate`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });

      fetchUsers();
    } catch (error) {
      alert('Error deactivating user');
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Staff Management</h1>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Staff'}
          </Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <form onSubmit={addUser} className="space-y-4">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="role">Role</Label>
                <Select
                  id="role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="DOCTOR">Doctor</option>
                  <option value="NURSE">Nurse</option>
                  <option value="PHARMACIST">Pharmacist</option>
                  <option value="STAFF">Front Desk</option>
                </Select>
              </div>

              <Button type="submit" className="w-full">Add Staff Member</Button>
            </form>
          </Card>
        )}

        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="space-y-3">
            {users.map((user: any) => (
              <Card key={user.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold">{user.name}</h3>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900 inline-block mt-1">
                      {roleLabel((user as any).role)}
                    </span>
                  </div>
                  <div className="flex gap-2 items-center">
                    {user.isActive ? (
                      <Button size="sm" variant="destructive" onClick={() => deactivateUser(user.id)}>
                        Deactivate
                      </Button>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded bg-red-100">Inactive</span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}