import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

describe("service / info / server", () => {
  test("@service title goes to info.title", async () => {
    const r = await emit(`
      @service(#{ title: "Demo" })
      @info(#{ version: "1.2.3" })
      namespace Demo;
    `);
    expectNoErrors(r);
    expect((r.doc as any).info.title).toBe("Demo");
    expect((r.doc as any).info.version).toBe("1.2.3");
  });

  test("@info populates description, contact, license", async () => {
    const r = await emit(`
      @service(#{ title: "Demo" })
      @info(#{
        version: "1.2.3",
        description: "Demo сервис",
        contact: #{ name: "ABC", url: "https://abc/" },
        license: #{ name: "MIT" },
      })
      namespace Demo;
    `);
    expectNoErrors(r);
    expect((r.doc as any).info).toEqual({
      title: "Demo",
      version: "1.2.3",
      description: "Demo сервис",
      contact: { name: "ABC", url: "https://abc/" },
      license: { name: "MIT" },
    });
  });

  test("@server adds entry to servers", async () => {
    const r = await emit(`
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      @server("public", #{
        host: "rabbit:5672",
        pathname: "/vh",
        protocol: "amqp",
        description: "Rabbit",
      })
      namespace Demo;
    `);
    expectNoErrors(r);
    expect((r.doc as any).servers.public).toEqual({
      host: "rabbit:5672",
      pathname: "/vh",
      protocol: "amqp",
      description: "Rabbit",
    });
  });

  test("multiple servers", async () => {
    const r = await emit(`
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      @server("prod", #{ host: "prod:5672", protocol: "amqp" })
      @server("dev", #{ host: "dev:5672", protocol: "amqp" })
      namespace Demo;
    `);
    expectNoErrors(r);
    expect((r.doc as any).servers).toEqual({
      prod: { host: "prod:5672", protocol: "amqp" },
      dev: { host: "dev:5672", protocol: "amqp" },
    });
  });
});
