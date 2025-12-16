'use client';

import React from 'react';
import { toast } from "sonner"
import { login } from '@/actions/auth';
import { useRouter } from 'next/navigation';
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [loading, setLoading] = React.useState(false);
  const router = useRouter();
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true);
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);

    try {
      const result = await login(formData);
      if (result?.error) {
        toast.error(result.error);
        setLoading(false);
      } 
      // Successful login redirects automatically
    } catch (error) {
      console.error(error);
      toast.error('An error occurred');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
        {/* Background effect */}
        <div className="absolute inset-0 z-0 opacity-20 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 to-black z-0"></div>

      <Card className="w-full max-w-md z-10 border border-white/10 bg-black/50 backdrop-blur-xl p-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Admin Access</h1>
          <p className="text-gray-400">Enter your credentials to continue</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-white">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-white">Password</Label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
              required
            />
          </div>
          <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

