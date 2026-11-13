const NIGHT_START = 24;
const NIGHT_END = 0;
const TIME_ZONE = "Europe/Warsaw";

export class AmazonNightSchedule {
  constructor(private now = () => new Date()) {}

  isNight() {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIME_ZONE })
        .format(this.now())
    );
    return hour >= NIGHT_START || hour < NIGHT_END;
  }
}
