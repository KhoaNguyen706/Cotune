package com.cotune.realtime;

import com.cotune.realtime.dto.RealtimeError;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.web.bind.annotation.ControllerAdvice;

/**
 * A message that blows up has nowhere to go by default — no HTTP response
 * to put a 4xx in — so without this handler a rejected op fails SILENTLY:
 * the client's note stays on screen, the server never stored it, and the
 * two disagree until the next reload. That is the worst possible failure
 * mode for an editor, so the error is routed back to the one client that
 * caused it.
 *
 * @ControllerAdvice rather than a handler inside RealtimeController (where
 * it lived first): @MessageExceptionHandler only covers its own controller,
 * and the day chat became a second @MessageMapping controller its failures
 * would have gone back to being silent — the exact bug this exists to
 * prevent, reintroduced by the feature that made it matter more.
 *
 * @SendToUser targets THIS session's private queue; Spring rewrites
 * /user/** per session, so one collaborator's error never lands in
 * another's client.
 */
@ControllerAdvice
public class RealtimeExceptionAdvice {

    private static final Logger log = LoggerFactory.getLogger(RealtimeExceptionAdvice.class);

    @MessageExceptionHandler
    @SendToUser("/queue/errors")
    public RealtimeError onError(Exception failure) {
        log.warn("Realtime op rejected: {}", failure.toString());
        String message = failure.getMessage() == null ? "Edit rejected" : failure.getMessage();
        return new RealtimeError(message);
    }
}
