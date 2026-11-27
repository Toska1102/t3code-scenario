import { createRoot } from "react-dom/client";

import { TaskReviewDemo } from "./tasks/TaskReviewDemo";

import { getInitialSession, WorkbenchSession } from "./WorkbenchSession";
import "./session.css";

const root = createRoot(document.getElementById("root")!);
void getInitialSession().then((initial) => {
  root.render(
    <WorkbenchSession initial={initial}>
      <TaskReviewDemo />
    </WorkbenchSession>,
  );
});
