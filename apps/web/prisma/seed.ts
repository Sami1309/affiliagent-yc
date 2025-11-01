import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.metric.deleteMany();
  await prisma.post.deleteMany();
  await prisma.creative.deleteMany();
  await prisma.affiliateLink.deleteMany();
  await prisma.product.deleteMany();
  await prisma.runLog.deleteMany();

  const products = [
    {
      title: "AeroPress Go Portable Coffee Maker",
      url: "https://www.amazon.com/dp/B07PJ4P9DR",
      merchant: "Amazon",
      images: [
        "https://images.example.com/aeropress/main.jpg",
        "https://images.example.com/aeropress/detail.jpg"
      ],
      priceCents: null,
      tags: ["coffee", "travel"],
    },
    {
      title: "Hyperbell Adjustable Dumbbell Handle Set",
      url: "https://www.amazon.com/dp/B0B8TQ1S8T",
      merchant: "Amazon",
      images: [
        "https://images.example.com/hyperbell/main.jpg"
      ],
      priceCents: null,
      tags: ["fitness", "home-gym"],
    },
    {
      title: "Philips SmartSleep Wake-up Light",
      url: "https://www.amazon.com/dp/B076HBQMCF",
      merchant: "Amazon",
      images: [
        "https://images.example.com/smartsleep/main.jpg"
      ],
      priceCents: null,
      tags: ["wellness", "sleep"],
    }
  ];

  await Promise.all(
    products.map((product) => {
      const { images, tags, ...rest } = product;
      return prisma.product.create({
        data: {
          ...rest,
          images: JSON.stringify(images),
          tags: JSON.stringify(tags),
          sourceRunId: "seed-run",
          creatives: {
            create: {
              type: "video",
              script: "Narrate benefits + compliance reminder to check Amazon for current pricing.",
              hook: "Upgrade your routine in 60 seconds",
              prompt: "Generate a 45-second vertical video storyboard",
              assetUrl: "https://videos.example.com/placeholder.mp4",
              coverUrl: "https://images.example.com/placeholder-cover.jpg",
              posts: {
                create: {
                  channel: "pinterest",
                  status: "queued",
                },
              },
            },
          },
          links: {
            create: {
              network: "amazon-associates",
              deepLink: `${product.url}?tag=affiliate-demo-20`,
              subId: "demo-sub-001",
              shortLink: `${product.url}?tag=affiliate-demo-20`,
            },
          },
        },
      });
    })
  );

  await prisma.runLog.createMany({
    data: [
      {
        runId: "demo-run",
        agent: "DealHunter",
        level: "info",
        message: "Seeded example products into the queue.",
      },
      {
        runId: "demo-run",
        agent: "LinkBuilder",
        level: "info",
        message: "Generated Amazon Associates SiteStripe links (demo tag).",
      },
      {
        runId: "demo-run",
        agent: "CreativeChef",
        level: "info",
        message: "Rendered mock creative assets.",
      },
      {
        runId: "demo-run",
        agent: "Publisher",
        level: "warn",
        message: "Waiting on API credentials before publishing.",
      },
    ],
  });
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
