import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { buildMatchingsFeed, type MatchingsCard } from '@/app/api/ios/getMatchings/_shared';

type NearbyPersonResponse = {
  userId: string;
  avatar: string | null;
  username: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  profession: string | null;
  postImages: string[];
  longitude: number;
  latitude: number;
  distanceMiles: number;
};

type MapboxFeature = {
  geometry?: { coordinates?: [number, number] };
};

const POI_QUERIES = ['restaurant', 'supermarket', 'park', 'bar', 'hotel'] as const;

const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authHeader } },
    }
  );
};

function parseCoordinate(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  return num;
}

function deduplicateCoordinates(coords: Array<{ longitude: number; latitude: number }>) {
  const seen = new Set<string>();
  return coords.filter((coord) => {
    const key = `${coord.latitude.toFixed(3)},${coord.longitude.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function haversineMiles(
  origin: { longitude: number; latitude: number },
  destination: { longitude: number; latitude: number }
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;

  const dLat = toRad(destination.latitude - origin.latitude);
  const dLon = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

async function fetchMapboxCategoryPOIs(params: {
  query: string;
  longitude: number;
  latitude: number;
  token: string;
  limit: number;
}) {
  const encodedQuery = encodeURIComponent(params.query);
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/category/${encodedQuery}`);
  url.searchParams.set('proximity', `${params.longitude},${params.latitude}`);
  url.searchParams.set('limit', `${Math.min(Math.max(params.limit, 1), 10)}`);
  url.searchParams.set('access_token', params.token);

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) return [];

  const json = (await response.json()) as { features?: MapboxFeature[] };
  return (json.features ?? [])
    .map((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return { longitude, latitude };
    })
    .filter((coord): coord is { longitude: number; latitude: number } => Boolean(coord));
}

async function fetchNearbyPOIs(params: {
  longitude: number;
  latitude: number;
  needed: number;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? process.env.MAPBOX_ACCESS_TOKEN ?? '';
  if (!token) return [];

  const selectedQueries = [...POI_QUERIES]
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);

  const batches = await Promise.all(
    selectedQueries.map((query) =>
      fetchMapboxCategoryPOIs({
        query,
        longitude: params.longitude,
        latitude: params.latitude,
        token,
        limit: 10,
      })
    )
  );

  const unique = deduplicateCoordinates(batches.flat());
  if (unique.length === 0) return [];

  const shuffled = [...unique].sort(() => Math.random() - 0.5);
  const result: Array<{ longitude: number; latitude: number }> = [];
  while (result.length < params.needed) {
    result.push(...shuffled);
  }
  return result.slice(0, params.needed);
}

function pairPeopleWithCoordinates(params: {
  cards: MatchingsCard[];
  coordinates: Array<{ longitude: number; latitude: number }>;
  userLocation: { longitude: number; latitude: number };
}): NearbyPersonResponse[] {
  if (params.coordinates.length === 0) return [];
  return params.cards
    .map((card, index) => {
      const coordinate = params.coordinates[index % params.coordinates.length];
      return {
        ...card,
        longitude: coordinate.longitude,
        latitude: coordinate.latitude,
        distanceMiles: haversineMiles(params.userLocation, coordinate),
      };
    })
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }

    const longitude = parseCoordinate(body.longitude);
    const latitude = parseCoordinate(body.latitude);
    if (longitude === null || latitude === null) {
      return NextResponse.json(
        { error: 'Invalid request body: longitude and latitude are required numbers.' },
        { status: 400 }
      );
    }

    const cards = await buildMatchingsFeed({
      supabase,
      viewerUserId: authData.user.id,
      body: { visitedUserIds: [], count: 20, imageCount: 7 },
    });
    if (cards.length === 0) return NextResponse.json([]);

    const poiCoordinates = await fetchNearbyPOIs({
      longitude,
      latitude,
      needed: cards.length,
    });

    const payload = pairPeopleWithCoordinates({
      cards,
      coordinates: poiCoordinates,
      userLocation: { longitude, latitude },
    });

    return NextResponse.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
