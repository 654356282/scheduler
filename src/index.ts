import {
  scheduleCallback,
  UserBlockingPriority,
  ImmediatePriority,
} from "./schduler.js";

scheduleCallback(UserBlockingPriority, () => {
  console.log("UserBlockingPriority");
});

scheduleCallback(ImmediatePriority, () => {
  console.log("ImmediatePriority");
});
