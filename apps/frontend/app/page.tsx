'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [formData, setFormData] = useState({
    clinicName: '',
    contactPerson: '',
    phone: '',
    email: '',
    preferredPlan: 'PROFESSIONAL',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const user = localStorage.getItem('user');
    if (user) {
      router.push('/dashboard');
    }
  }, [router]);

  const handleDemoRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // TODO: Save to database (we'll add this later)
    console.log('Demo request:', formData);
    
    setSubmitted(true);
    setTimeout(() => {
      setShowDemoModal(false);
      setSubmitted(false);
      setFormData({
        clinicName: '',
        contactPerson: '',
        phone: '',
        email: '',
        preferredPlan: 'PROFESSIONAL',
        message: ''
      });
    }, 3000);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50">
      {/* Demo Request Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-2xl w-full p-8 max-h-[90vh] overflow-y-auto">
            {!submitted ? (
              <>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Request a Demo 🎯</h2>
                    <p className="text-muted-foreground">Tell us about your clinic and we'll get back to you within 24 hours</p>
                  </div>
                  <button
                    onClick={() => setShowDemoModal(false)}
                    className="text-2xl hover:text-red-600"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleDemoRequest} className="space-y-4">
                  <div>
                    <Label htmlFor="clinicName">Clinic Name *</Label>
                    <Input
                      id="clinicName"
                      value={formData.clinicName}
                      onChange={(e) => setFormData({ ...formData, clinicName: e.target.value })}
                      placeholder="ABC Medical Center"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="contactPerson">Contact Person *</Label>
                      <Input
                        id="contactPerson"
                        value={formData.contactPerson}
                        onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                        placeholder="Dr. John Doe"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone Number *</Label>
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
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="admin@abcclinic.ug"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="preferredPlan">Preferred Plan</Label>
                    <select
                      id="preferredPlan"
                      className="w-full p-2 border rounded"
                      value={formData.preferredPlan}
                      onChange={(e) => setFormData({ ...formData, preferredPlan: e.target.value })}
                    >
                      <option value="BASIC">Basic - UGX 150k/month</option>
                      <option value="PROFESSIONAL">Professional - UGX 300k/month</option>
                      <option value="ENTERPRISE">Enterprise - UGX 500k/month</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="message">Additional Information (Optional)</Label>
                    <textarea
                      id="message"
                      className="w-full p-2 border rounded min-h-[100px]"
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      placeholder="Tell us about your clinic size, current challenges, or any questions..."
                    />
                  </div>

                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h3 className="font-semibold mb-2">What happens next?</h3>
                    <ol className="text-sm space-y-1 text-muted-foreground">
                      <li>1️⃣ We'll review your request within 24 hours</li>
                      <li>2️⃣ Our team will contact you to schedule a personalized demo</li>
                      <li>3️⃣ After the demo, we'll help you get started with a 7-day free trial</li>
                      <li>4️⃣ Once you're ready, we'll set up your clinic account</li>
                    </ol>
                  </div>

                  <Button type="submit" className="w-full" size="lg">
                    Submit Demo Request
                  </Button>
                </form>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-2xl font-bold mb-2">Request Submitted!</h3>
                <p className="text-muted-foreground mb-4">
                  Thank you for your interest in Bulamu. We'll contact you within 24 hours to schedule your personalized demo.
                </p>
                <p className="text-sm text-slate-600">
                  Check your email at <strong>{formData.email}</strong>
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Hero Section with Image */}
      <section className="container mx-auto px-8 py-20">
        <div className="grid grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-slate-800 bg-clip-text text-transparent">
              Bulamu 🏥
            </h1>
            <p className="text-3xl text-slate-700 mb-3 font-semibold">Your clinic, digitized</p>
            <p className="text-xl text-slate-600 mb-8">
              Complete clinic management system for Uganda. Streamline patient records, appointments, consultations, billing & inventory.
            </p>
            
            <div className="flex gap-4 mb-8">
              <Button 
                size="lg" 
                className="text-lg px-10 py-6"
                onClick={() => setShowDemoModal(true)}
              >
                Request Demo
              </Button>
              <Link href="/auth/login">
                <Button size="lg" variant="outline" className="text-lg px-10 py-6">
                  Sign In
                </Button>
              </Link>
            </div>

            <p className="text-sm text-slate-500">7-day free trial • Personalized onboarding • Made in Uganda 🇺🇬</p>
          </div>

          <div className="relative">
            <img 
              src="https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&q=80"
              alt="African doctor with patient"
              className="rounded-2xl shadow-2xl"
            />
            <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-xl shadow-xl">
              <p className="text-sm text-muted-foreground mb-1">Trusted by</p>
              <p className="text-3xl font-bold text-blue-600">10+ Clinics</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-slate-50 py-16">
        <div className="container mx-auto px-8">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-4 gap-8 max-w-6xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">1</div>
              <h3 className="font-bold mb-2">Request Demo</h3>
              <p className="text-sm text-muted-foreground">Fill the form and tell us about your clinic</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">2</div>
              <h3 className="font-bold mb-2">Get Personalized Demo</h3>
              <p className="text-sm text-muted-foreground">We'll show you how Bulamu works for your clinic</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">3</div>
              <h3 className="font-bold mb-2">Choose Your Plan</h3>
              <p className="text-sm text-muted-foreground">Pick Basic, Professional or Enterprise</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">4</div>
              <h3 className="font-bold mb-2">Go Live</h3>
              <p className="text-sm text-muted-foreground">We set up your account and train your team</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-8 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Everything Your Clinic Needs</h2>
        <div className="grid grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <p className="text-4xl mb-3">📋</p>
            <h3 className="font-bold text-lg mb-2">Patient Records</h3>
            <p className="text-sm text-muted-foreground">Complete digital medical history with search & filters</p>
          </Card>
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <p className="text-4xl mb-3">📅</p>
            <h3 className="font-bold text-lg mb-2">Appointments</h3>
            <p className="text-sm text-muted-foreground">Smart scheduling with automated reminders</p>
          </Card>
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <p className="text-4xl mb-3">💊</p>
            <h3 className="font-bold text-lg mb-2">Consultations</h3>
            <p className="text-sm text-muted-foreground">Record diagnosis, prescriptions & treatment plans</p>
          </Card>
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <p className="text-4xl mb-3">🔬</p>
            <h3 className="font-bold text-lg mb-2">Lab Tests</h3>
            <p className="text-sm text-muted-foreground">Order tests & track results efficiently</p>
          </Card>
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <p className="text-4xl mb-3">💰</p>
            <h3 className="font-bold text-lg mb-2">Billing & Invoices</h3>
            <p className="text-sm text-muted-foreground">Automated invoicing with payment tracking</p>
          </Card>
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <p className="text-4xl mb-3">📊</p>
            <h3 className="font-bold text-lg mb-2">Reports & Analytics</h3>
            <p className="text-sm text-muted-foreground">Insights on revenue, patients & trends</p>
          </Card>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="container mx-auto px-8 py-20">
        <h2 className="text-3xl font-bold text-center mb-4">Simple, Transparent Pricing</h2>
        <p className="text-center text-muted-foreground mb-12">Choose the plan that fits your clinic. Upgrade or downgrade anytime.</p>
        
        <div className="grid grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Basic */}
          <Card className="p-8 hover:shadow-xl transition-shadow">
            <h3 className="text-2xl font-bold mb-2">Basic</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold">UGX 150k</span>
              <span className="text-muted-foreground">/month</span>
              <p className="text-sm text-muted-foreground mt-1">~$40 USD</p>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Up to 3 users</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">500 patient records</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Appointments & scheduling</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Basic billing</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Email support</span>
              </li>
            </ul>
            <Button className="w-full" variant="outline" onClick={() => setShowDemoModal(true)}>
              Get Started
            </Button>
          </Card>

          {/* Professional */}
          <Card className="p-8 border-2 border-blue-600 hover:shadow-xl transition-shadow relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-semibold">
              Most Popular
            </div>
            <h3 className="text-2xl font-bold mb-2">Professional</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold">UGX 300k</span>
              <span className="text-muted-foreground">/month</span>
              <p className="text-sm text-muted-foreground mt-1">~$80 USD</p>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Up to 10 users</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Unlimited patients</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Full consultations & prescriptions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Lab tests & inventory</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Reports & analytics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Priority support</span>
              </li>
            </ul>
            <Button className="w-full" onClick={() => setShowDemoModal(true)}>
              Get Started
            </Button>
          </Card>

          {/* Enterprise */}
          <Card className="p-8 hover:shadow-xl transition-shadow">
            <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold">UGX 500k</span>
              <span className="text-muted-foreground">/month</span>
              <p className="text-sm text-muted-foreground mt-1">~$135 USD</p>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Unlimited users</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Multi-location support</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">All Professional features</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Custom integrations</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">Dedicated account manager</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm">24/7 phone support</span>
              </li>
            </ul>
            <Button className="w-full" variant="outline" onClick={() => setShowDemoModal(true)}>
              Contact Sales
            </Button>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-600 text-white py-16">
        <div className="container mx-auto px-8 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Transform Your Clinic?</h2>
          <p className="text-xl mb-8 opacity-90">Join Ugandan clinics going digital with Bulamu</p>
          <Button 
            size="lg" 
            variant="secondary" 
            className="text-lg px-10 py-6"
            onClick={() => setShowDemoModal(true)}
          >
            Request Your Demo Today
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-8">
        <div className="container mx-auto px-8 text-center">
          <p className="mb-2">© 2025 Bulamu. All rights reserved.</p>
          <p className="text-sm">Made in Uganda 🇺🇬 for Ugandan healthcare</p>
        </div>
      </footer>
    </main>
  );
}