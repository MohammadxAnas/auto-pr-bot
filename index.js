import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

export default (app) => {
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    try {
      console.log("Getting PR diff..");
      const pr = context.payload.pull_request;
      const owner = context.payload.repository.owner.login;
      const repo = context.payload.repository.name;

      const diffResponse = await context.octokit.request(
        `GET /repos/${owner}/${repo}/pulls/${pr.number}`,
        {
          headers: {
            accept: "application/vnd.github.v3.diff",
          },
        }
      );

      const diff = diffResponse.data;
      console.log(diff);

      console.log("Calling Gemini...");

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{
                  text: `You're a helpful assistant that writes GitHub pull request titles and summaries.

                        Here is the code diff for a PR:

                        ${diff}

                        Respond in this format exactly:

                        Title: <a concise title here>

                        Summary:
                        <a short paragraph summary here>`
                }]
              }
            ]
          }),
        }
      );

      const result = await geminiResponse.json();
      const aiResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

      console.log(" Parsing Gemini response...");
      let aiTitle = "AI-generated PR";
      let aiSummary = "";

      const [titleLine, ...rest] = aiResponse.split("Summary:");

      if (titleLine.toLowerCase().includes("title:")) {
        aiTitle = titleLine.split("Title:")[1].trim();
      }

      if (rest.length > 0) {
        aiSummary = rest.join("Summary:").trim(); 
      }

      console.log("Updating PR title and body...");
      await context.octokit.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        title: aiTitle,
        body: `${pr.body || ""}${aiSummary}`,
      });

      console.log(`PR #${pr.number} updated with AI`);
    } catch (err) {
      console.error("Failed to update PR with Gemini");
      console.error(err.stack || err.message || err);
    }
  });
};
