package com.cotune.common.graphql;

import graphql.scalars.ExtendedScalars;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.RuntimeWiringConfigurer;

@Configuration
public class GraphqlConfig {

    /**
     * The schema declares `scalar DateTime`, but a declaration is just a
     * name — graphql-java needs a coercion implementation (how to
     * serialize/parse it). Without this bean the app fails at startup with
     * "There is no scalar implementation for DateTime", which is the
     * fail-fast behavior we want: schema and runtime must agree.
     */
    @Bean
    public RuntimeWiringConfigurer runtimeWiringConfigurer() {
        return wiringBuilder -> wiringBuilder.scalar(ExtendedScalars.DateTime);
    }
}
