'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Send } from 'lucide-react';
import { roleLabel } from '@/lib/role-labels';

type Comment = {
  id: string;
  body: string;
  authorRole: string;
  authorName: string;
  createdAt: string;
};

export function CommentsSection({
  entityType,
  entityId,
  title,
  placeholder,
}: {
  entityType: 'FEEDBACK' | 'PATIENT';
  entityId?: string;
  title: string;
  placeholder: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const token = localStorage.getItem('token');
    try {
      const params = new URLSearchParams({ entityType, ...(entityId ? { entityId } : {}) });
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/comments?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setComments(data.comments);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entityType, entityId, body }),
      });
      const data = await res.json();
      if (data.success) {
        setBody('');
        await load();
      } else {
        alert(data.error || 'Could not post comment');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="rounded-lg p-5">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-4 text-emerald-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{title}</h2>
      </div>

      {!loading && comments.length > 0 && (
        <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {c.authorName} <span className="font-normal text-slate-400">- {roleLabel(c.authorRole)}</span>
                </p>
                <p className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleString()}</p>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{c.body}</p>
            </div>
          ))}
        </div>
      )}
      {!loading && comments.length === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No comments yet.</p>
      )}

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="min-h-16 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={submitting || !body.trim()} className="self-end">
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </form>
    </Card>
  );
}
