import {
  json,
  serve,
  validateRequest,
} from "https://deno.land/x/sift@0.4.0/mod.ts";

import { Rcon } from "./rcon.ts";

import { RconRequestDto } from "./types.ts";

serve({
  "/": home,
  404: notFound,
});

function notFound() {
  return json({
    statusCode: 404,
    message: "Not found",
    error: "Not Found",
  });
}

async function home(req: Request) {
  let body: RconRequestDto;
  try {
    body = await validateBody(req);
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }

    throw err;
  }

  try {
    const rcon = new Rcon(body.ip, body.port ?? 27015, body.password);

    const response = await rcon.sendCmd(body.command);

    return json({
      statusCode: 200,
      response,
    });
  } catch (_err) {
    console.log(_err);
    return json({
      statusCode: 400,
      message: "Bad RCON details",
      error: "Bad Request",
    });
  }
}

async function validateBody(req: Request) {
  try {
    const { error, body } = await validateRequest(req, {
      POST: {
        body: ["ip", "password", "command"],
      },
    });

    if (error) {
      throw json({ error: error.message }, { status: error.status });
    }

    return body as unknown as RconRequestDto;
  } catch (_err) {
    throw json({
      statusCode: 400,
      message: "Body must be present",
      error: "Bad Request",
    });
  }
}
