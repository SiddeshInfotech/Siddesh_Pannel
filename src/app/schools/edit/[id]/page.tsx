import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import EditSchoolClient from './EditSchoolClient';
import { notFound } from 'next/navigation';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

interface PageProps {
  params: any;
}

// Direct fetch (page is force-dynamic): avoids the Next 16 unstable_cache
// failure that 500'd this page in production.
async function getSchool(id: string) {
  const { data: school, error } = await supabaseAdmin
    .from('schools')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !school) return null;
  return school;
}

export default async function EditSchoolPage({ params }: PageProps) {
  const session = await getAdminSession();
  if (!session) return null;

  const resolvedParams = await params;
  const id = resolvedParams?.id;

  if (!id) return notFound();

  const school = await getSchool(id);

  if (!school) return notFound();

  const schoolData = {
    dbId: school.id,
    name: school.name,
    board: school.board as any,
    mediums: school.mediums || [],
    // Flat columns (no longer nested address/contact/infrastructure)
    street: school.street || '',
    city: school.city || '',
    state: school.state || '',
    zipCode: school.zip_code || '',
    coordinatorName: school.coordinator_name || '',
    email: school.email || '',
    phone: school.phone || '',
    classroomsCount: school.classrooms_count || 0,
  };

  return <EditSchoolClient school={schoolData} />;
}
