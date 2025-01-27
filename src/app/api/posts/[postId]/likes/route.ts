import getServerSession from '@/lib/get-server-session';
import { prisma } from '@/lib/prisma';
import { LikeInfo } from '@/lib/types';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
interface IPostIdProps {
  params: {
    postId: string;
  };
}
const likeratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(40, '60s'),
  ephemeralCache: new Map(),
  prefix: '@upstash/ratelimit/like',
  analytics: true,
});
const unlikeratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(40, '60s'),
  ephemeralCache: new Map(),
  prefix: '@upstash/ratelimit/un-like',
  analytics: true,
});

export async function GET(
  req: NextRequest,
  { params: { postId } }: IPostIdProps
) {
  try {
    const session = await getServerSession();
    const loggedInUser = session?.user;
    if (!loggedInUser)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        likes: {
          where: {
            userId: loggedInUser.id,
          },
          select: {
            userId: true,
          },
        },
        _count: {
          select: {
            likes: true,
          },
        },
      },
    });
    if (!post)
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    const data: LikeInfo = {
      likes: post._count.likes,
      isLikedByUser: !!post.likes.length,
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Internal Server Error.' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params: { postId } }: IPostIdProps
) {
  try {
    const session = await getServerSession();
    const loggedInUser = session?.user;
    if (!loggedInUser)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ip = (req.headers.get('x-forwarded-for') ?? '127.0.0.1').split(
      ','
    )[0];
    const { remaining } = await likeratelimit.limit(ip);
    if (remaining === 0) {
      return NextResponse.json(
        {
          message:
            'You are sending too many requests. Please try again after sometime',
        },
        { status: 429 }
      );
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        userId: true,
      },
    });

    if (!post)
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    await prisma.$transaction([
      prisma.like.upsert({
        where: {
          userId_postID: {
            userId: loggedInUser.id!,
            postID: postId,
          },
        },
        create: {
          userId: loggedInUser.id!,
          postID: postId,
        },
        update: {},
      }),
      ...(loggedInUser.id !== post.userId
        ? [
            prisma.notification.create({
              data: {
                issuerId: loggedInUser.id!,
                recipientId: post.userId,
                postId,
                type: 'LIKE',
              },
            }),
          ]
        : []),
    ]);

    return new NextResponse();
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Internal Server Error.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params: { postId } }: IPostIdProps
) {
  try {
    const session = await getServerSession();
    const loggedInUser = session?.user;
    if (!loggedInUser)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ip = (req.headers.get('x-forwarded-for') ?? '127.0.0.1').split(
      ','
    )[0];
    const { remaining } = await unlikeratelimit.limit(ip);
    if (remaining === 0) {
      return NextResponse.json(
        {
          message:
            'You are sending too many requests. Please try again after sometime',
        },
        { status: 429 }
      );
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        userId: true,
      },
    });

    if (!post)
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    await prisma.$transaction([
      prisma.like.deleteMany({
        where: {
          userId: loggedInUser.id!,
          postID: postId,
        },
      }),
      prisma.notification.deleteMany({
        where: {
          issuerId: loggedInUser.id!,
          recipientId: post.userId,
          postId,
          type: 'LIKE',
        },
      }),
    ]);
    return new NextResponse();
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Internal Server Error.' },
      { status: 500 }
    );
  }
}
