import { getDisplayDevice } from "@/lib/display-auth";
import PairingForm from "./PairingForm";
import QueueDisplayClient from "./QueueDisplayClient";

export const dynamic = "force-dynamic";

export default async function DisplayPage() {
  const device = await getDisplayDevice();
  if (!device) return <PairingForm />;
  return <QueueDisplayClient deviceId={device.id} deviceName={device.name} />;
}
