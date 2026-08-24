import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding dev data…");

  const org = await prisma.organization.create({
    data: {
      name: "BrightBean Dev",
      slug: "brightbean-dev",
    },
  });

  const adminRole = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: "Admin",
      permissions: [
        "create_posts",
        "publish_directly",
        "upload_media",
        "view_analytics",
      ],
      isSystem: true,
    },
  });

  await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: "Main Workspace",
      slug: "main",
    },
  });

  console.log("Seed complete. Create a user via signup once auth lands,");
  console.log(`then attach it to org ${org.id} with role ${adminRole.id}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
