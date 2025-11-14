import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Welcome = () => (
  <Card>
    <CardHeader className="px-4">
      <CardTitle>Your CRM Starter Kit</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-sm mb-4">
        Colorado CareAssist CRM is built on top of{" "}
        <a
          href="https://marmelab.com/atomic-crm"
          className="underline hover:no-underline"
        >
          Marmelab's Atomic CRM template
        </a>{" "}
        to deliver a home-care focused workspace.
      </p>
      <p className="text-sm mb-4">
        This demo runs on a mock API, so you can explore and modify the data. It
        resets on reload. The full version uses Supabase for the backend.
      </p>
      <p className="text-sm">
        Powered by{" "}
        <a
          href="https://marmelab.com/shadcn-admin-kit"
          className="underline hover:no-underline"
        >
          shadcn-admin-kit
        </a>
        , the entire solution remains open-source. You can explore the
        underlying template at{" "}
        <a
          href="https://github.com/marmelab/atomic-crm"
          className="underline hover:no-underline"
        >
          marmelab/atomic-crm
        </a>
        .
      </p>
    </CardContent>
  </Card>
);
